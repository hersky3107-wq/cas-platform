import 'server-only'

import { runSingleAiProvider } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import {
  getChannel,
  getDeposit,
  getEffectiveRuleForChannel,
  getReconciliation,
  getSale,
  saveDiscrepancyAdvisory,
} from '@/lib/reconciliation/db'
import type { ChannelRule } from '@/lib/reconciliation/channel-rules'
import type { OwnedScope } from '@/lib/reconciliation/scope'
import {
  parseDiscrepancyAdvisory,
  type DalResult,
  type DepositRecord,
  type DiscrepancyAdvisory,
  type PaymentChannel,
  type ReconStatus,
  type SalesRecord,
} from '@/lib/reconciliation/types'

/**
 * Single-AI discrepancy explanation for card-type amount_mismatch rows.
 *
 * ADVISORY ONLY: never writes status / resolved / discrepancy_amount.
 * The matcher is not called. Multi-AI cross-check is a later step.
 *
 * sessionId is null so the call does not write generic session tables
 * (same pattern as parseDeposit).
 */

export type ExplainDiscrepancyResult = {
  reconciliation_id: string
  status: ReconStatus
  advisory: DiscrepancyAdvisory
  cached: boolean
}

const SYSTEM_PROMPT = [
  'You estimate why a Korean card-settlement deposit does not match the expected net amount.',
  'This estimate is ADVISORY ONLY. A human must confirm it. You do not resolve, accept, or change any reconciliation status.',
  'Respond with ONLY a compact JSON object, no prose, no code fences:',
  '{"estimated_cause":"<short text>","confidence":"low"|"medium"|"high","reasoning":"<1-2 sentences>"}',
  'confidence: "high" if the gap size closely matches a known fee/deduction pattern given the stated rule;',
  '"medium" if a fee, promotion, ad deduction, refund, or rounding is plausible but not tightly matching;',
  '"low" if the gap does NOT look like a normal fee or deduction (possible omitted sale, extra funds, or data error).',
  'Do NOT force a fee explanation when the gap does not look like a normal fee or deduction — say so, and set confidence to low.',
  'estimated_cause is a short label (examples: "card fee rate differs from assumed 2.5%", "possible delivery-app ad/promotion deduction", "possible partial refund", "rounding", "possible missing or extra funds").',
  'reasoning is 1-2 sentences that cite the numbers. Do not invent transactions that are not in the facts.',
].join(' ')

function dalOk<T>(data: T): DalResult<T> {
  return { ok: true, data }
}

function dalErr(status: number, error: string): DalResult<never> {
  return { ok: false, status, error }
}

function toWon(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.replace(/```(?:json)?/gi, '').trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(fenced.slice(start, end + 1))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* fall through */
  }
  return null
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max).trimEnd()
}

async function loadUniqueSales(
  scope: OwnedScope,
  ids: string[]
): Promise<DalResult<SalesRecord[]>> {
  const out: SalesRecord[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const sale = await getSale(scope, id)
    if (!sale.ok) return sale
    out.push(sale.data)
  }
  return dalOk(out)
}

async function loadUniqueDeposits(
  scope: OwnedScope,
  ids: string[]
): Promise<DalResult<DepositRecord[]>> {
  const out: DepositRecord[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const deposit = await getDeposit(scope, id)
    if (!deposit.ok) return deposit
    out.push(deposit.data)
  }
  return dalOk(out)
}

function buildFacts(params: {
  discrepancyAmount: number | null
  discrepancyReason: string | null
  sales: SalesRecord[]
  deposits: DepositRecord[]
  channel: PaymentChannel | null
  rule: ChannelRule
}): string {
  const grossTotal = params.sales.reduce((sum, s) => sum + toWon(s.gross_amount), 0)
  const expectedNetTotal = params.sales.reduce((sum, s) => {
    const stored = s.expected_net_amount
    return sum + (stored == null ? 0 : toWon(stored))
  }, 0)
  const actualTotal = params.deposits.reduce((sum, d) => sum + toWon(d.actual_amount), 0)
  const feeLabel =
    params.rule.feeType === 'percent'
      ? `${params.rule.feeRate}% percent`
      : `${params.rule.feeRate} KRW fixed`

  return JSON.stringify({
    channel_type: params.channel?.channel_type ?? params.rule.channelType ?? 'card',
    channel_name: params.channel?.name ?? null,
    rule: {
      fee_type: params.rule.feeType,
      fee_rate: params.rule.feeRate,
      fee_label: feeLabel,
      settlement_days: params.rule.settlementDays,
      tolerance_won: params.rule.toleranceWon,
    },
    sales: params.sales.map((s) => ({
      sale_date: s.sale_date,
      gross_amount: toWon(s.gross_amount),
      expected_net_amount: s.expected_net_amount == null ? null : toWon(s.expected_net_amount),
      expected_deposit_date: s.expected_deposit_date,
    })),
    deposits: params.deposits.map((d) => ({
      deposit_date: d.deposit_date,
      actual_amount: toWon(d.actual_amount),
    })),
    totals: {
      gross: grossTotal,
      expected_net: expectedNetTotal,
      actual_deposit: actualTotal,
      discrepancy: params.discrepancyAmount == null ? null : toWon(params.discrepancyAmount),
    },
    matcher_note: params.discrepancyReason,
    discrepancy_sign: 'discrepancy is expected_net minus actual_deposit (positive = deposit short)',
  })
}

export async function explainDiscrepancy(
  scope: OwnedScope,
  reconciliationId: string,
  opts?: { force?: boolean }
): Promise<DalResult<ExplainDiscrepancyResult>> {
  const recon = await getReconciliation(scope, reconciliationId)
  if (!recon.ok) return recon
  if (recon.data.status !== 'amount_mismatch') {
    return dalErr(
      409,
      `reconciliation is not amount_mismatch (status is ${recon.data.status})`
    )
  }

  if (!opts?.force) {
    const cached = parseDiscrepancyAdvisory(recon.data.discrepancy_advisory)
    if (cached) {
      return dalOk({
        reconciliation_id: recon.data.id,
        status: recon.data.status,
        advisory: cached,
        cached: true,
      })
    }
  }

  const saleIds = recon.data.matches
    .map((m) => m.sales_record_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  const depositIds = recon.data.matches
    .map((m) => m.deposit_record_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (saleIds.length === 0 || depositIds.length === 0) {
    return dalErr(400, 'amount_mismatch is missing linked sale or deposit')
  }

  const salesRes = await loadUniqueSales(scope, saleIds)
  if (!salesRes.ok) return salesRes
  const depositsRes = await loadUniqueDeposits(scope, depositIds)
  if (!depositsRes.ok) return depositsRes
  const sales = salesRes.data
  const deposits = depositsRes.data

  const channelId = sales.find((s) => s.channel_id)?.channel_id ?? null
  let channel: PaymentChannel | null = null
  if (channelId) {
    const ch = await getChannel(scope, channelId)
    if (!ch.ok) return ch
    channel = ch.data
  }
  const channelType = channel?.channel_type ?? (sales[0]?.sale_kind === 'card' ? 'card' : null)
  if (channelType !== 'card') {
    return dalErr(400, 'discrepancy explanation is only available for card-type mismatches')
  }

  const rule = await getEffectiveRuleForChannel(scope, channelId)
  const facts = buildFacts({
    discrepancyAmount: recon.data.discrepancy_amount,
    discrepancyReason: recon.data.discrepancy_reason,
    sales,
    deposits,
    channel,
    rule,
  })

  let modelText: string | null = null
  try {
    const result = await runSingleAiProvider({
      supabase: supabaseAdmin,
      sessionId: null,
      userId: scope.userId,
      provider: 'openai',
      systemPrompt: SYSTEM_PROMPT,
      prompt: facts,
      temperature: 0,
      maxCompletionTokens: 250,
      skipLanguageInjection: true,
    })
    modelText = result.text
  } catch (e) {
    const message = e instanceof Error ? e.message : 'AI provider failed'
    return dalErr(502, message)
  }

  const parsed = modelText ? extractJson(modelText) : null
  const advisory = parseDiscrepancyAdvisory(parsed)
  if (!advisory) {
    return dalErr(502, 'Could not obtain a discrepancy explanation')
  }

  const clipped: DiscrepancyAdvisory = {
    estimated_cause: clip(advisory.estimated_cause, 240),
    confidence: advisory.confidence,
    reasoning: clip(advisory.reasoning, 600),
  }

  const saved = await saveDiscrepancyAdvisory(scope, recon.data.id, clipped)
  if (!saved.ok) return saved
  if (saved.data.status !== 'amount_mismatch') {
    return dalErr(500, 'status changed while saving advisory (should be impossible)')
  }

  return dalOk({
    reconciliation_id: saved.data.id,
    status: saved.data.status,
    advisory: clipped,
    cached: false,
  })
}
