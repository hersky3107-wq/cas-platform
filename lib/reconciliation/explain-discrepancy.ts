import 'server-only'

import { callPlatformModel } from '@/lib/ai/platform-providers'
import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import {
  ADVISORY_MAX_COMPLETION_TOKENS,
  ADVISORY_MODELS,
  ADVISORY_MODEL_TIMEOUT_MS,
  type AdvisoryModelSpec,
} from '@/lib/reconciliation/config'
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
  RECONCILED_METHOD_CODES,
  type AdvisoryConfidence,
  type AdvisoryModelVote,
  type DalResult,
  type DepositRecord,
  type DiscrepancyAdvisory,
  type PaymentChannel,
  type ReconStatus,
  type SalesRecord,
} from '@/lib/reconciliation/types'

/**
 * Multi-AI discrepancy explanation for card-type amount_mismatch rows.
 *
 * N models (ADVISORY_MODELS) get the identical strict-JSON prompt in
 * parallel and their answers are cross-verified:
 *   - agreement on the cause  → consensus, confidence raised when unanimous
 *   - disagreement            → divergent views shown side by side, confidence lowered
 *   - partial failures        → aggregate over the models that responded
 *   - all failed              → 502, nothing fabricated, nothing persisted
 *
 * ADVISORY ONLY: never writes status / resolved / discrepancy_amount.
 * The matcher is not called. User-triggered + cached (re-run only on force).
 *
 * sessionId is null so the calls do not write generic session tables
 * (same pattern as parseDeposit).
 */

export type AdvisoryModelTiming = {
  model: string
  elapsed_ms: number
  ok: boolean
}

export type ExplainDiscrepancyResult = {
  reconciliation_id: string
  status: ReconStatus
  advisory: DiscrepancyAdvisory
  cached: boolean
  /** Fresh runs only — not persisted. Includes failures so slow/dead models are visible. */
  model_timings?: AdvisoryModelTiming[]
  wall_clock_ms?: number
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

/**
 * Cause buckets used ONLY to decide whether two free-text answers name the
 * same cause. Aligned with the example labels in SYSTEM_PROMPT. Keyword
 * order matters: anomaly phrasing ("does not look like a normal fee")
 * contains the word "fee", so the anomaly bucket is checked first.
 */
type CauseBucket = 'missing_or_extra' | 'refund' | 'rounding' | 'promotion_or_ad' | 'fee' | 'other'

function classifyCauseText(text: string): CauseBucket {
  const t = text.toLowerCase()
  if (
    /missing|omission|omit|unexplained|extra fund|anomal|data error|not (?:a |look like )?(?:normal )?fee|누락|초과|오류|이상/.test(
      t
    )
  ) {
    return 'missing_or_extra'
  }
  if (/refund|chargeback|환불|취소/.test(t)) return 'refund'
  if (/round|반올림|절사/.test(t)) return 'rounding'
  if (/promo|advertis|\bad\b|광고|프로모션|할인|delivery-app|배달/.test(t)) return 'promotion_or_ad'
  if (/fee|rate|수수료|정산율/.test(t)) return 'fee'
  return 'other'
}

function causeBucket(vote: AdvisoryModelVote): CauseBucket {
  const fromCause = classifyCauseText(vote.cause)
  if (fromCause !== 'other') return fromCause
  return classifyCauseText(`${vote.cause} ${vote.reasoning}`)
}

const CONFIDENCE_LEVELS: readonly AdvisoryConfidence[] = ['low', 'medium', 'high']

function shiftConfidence(value: AdvisoryConfidence, delta: 1 | -1): AdvisoryConfidence {
  const idx = CONFIDENCE_LEVELS.indexOf(value) + delta
  return CONFIDENCE_LEVELS[Math.min(2, Math.max(0, idx))]!
}

/** Lower median: for an even count the more cautious of the two middles. */
function conservativeMedianConfidence(votes: AdvisoryModelVote[]): AdvisoryConfidence {
  const sorted = votes
    .map((v) => CONFIDENCE_LEVELS.indexOf(v.confidence))
    .sort((a, b) => a - b)
  return CONFIDENCE_LEVELS[sorted[Math.floor((sorted.length - 1) / 2)]!]!
}

/**
 * Cross-verify the individual model votes into one advisory.
 *
 * - unanimous (all responders name the same bucket, >=2 responders):
 *   consensus confidence raised one level above the agreeing median.
 * - majority (>half agree): agreeing median kept as-is.
 * - no majority: divergent views listed side by side, confidence lowered
 *   one level below the overall median — the user decides, we never
 *   silently pick one model's answer.
 * - single responder: its answer unchanged (no raise for self-agreement).
 *
 * Two 'other'-bucket votes never count as agreeing (unclassifiable text is
 * biased toward divergence, the cautious direction).
 */
function aggregateVotes(votes: AdvisoryModelVote[], requested: number): DiscrepancyAdvisory {
  const groups = new Map<string, AdvisoryModelVote[]>()
  votes.forEach((vote, i) => {
    const bucket = causeBucket(vote)
    const key = bucket === 'other' ? `other:${i}` : bucket
    const group = groups.get(key)
    if (group) group.push(vote)
    else groups.set(key, [vote])
  })

  let agreeing: AdvisoryModelVote[] = []
  for (const group of groups.values()) {
    if (group.length > agreeing.length) agreeing = group
  }

  const agreement = `${agreeing.length}/${votes.length}`
  const respondedNote =
    votes.length < requested ? ` (${votes.length}/${requested} models responded)` : ''

  const base: Pick<
    DiscrepancyAdvisory,
    'agreement' | 'models_requested' | 'models_responded' | 'per_model'
  > = {
    agreement,
    models_requested: requested,
    models_responded: votes.length,
    per_model: votes,
  }

  if (votes.length === 1) {
    const only = votes[0]!
    return {
      estimated_cause: only.cause,
      confidence: only.confidence,
      reasoning: clip(`[1/${requested} models responded — no cross-check] ${only.reasoning}`, 600),
      consensus_cause: only.cause,
      final_confidence: only.confidence,
      ...base,
    }
  }

  const hasMajority = agreeing.length * 2 > votes.length
  if (hasMajority) {
    const unanimous = agreeing.length === votes.length
    // Most confident agreeing model speaks for the consensus text.
    const representative = agreeing.reduce((best, v) =>
      CONFIDENCE_LEVELS.indexOf(v.confidence) > CONFIDENCE_LEVELS.indexOf(best.confidence)
        ? v
        : best
    )
    const medianOfAgreeing = conservativeMedianConfidence(agreeing)
    const finalConfidence = unanimous ? shiftConfidence(medianOfAgreeing, 1) : medianOfAgreeing
    return {
      estimated_cause: representative.cause,
      confidence: finalConfidence,
      reasoning: clip(
        `[${agreement} models agree${respondedNote}] ${representative.reasoning}`,
        600
      ),
      consensus_cause: representative.cause,
      final_confidence: finalConfidence,
      ...base,
    }
  }

  // Divergence: no bucket holds a majority. Present every view, lower confidence.
  const finalConfidence = shiftConfidence(conservativeMedianConfidence(votes), -1)
  const sideBySide = votes.map((v) => `${v.model}: ${v.cause}`).join(' | ')
  return {
    estimated_cause: clip(`Models disagree — ${sideBySide}`, 240),
    confidence: finalConfidence,
    reasoning: clip(
      `Models did not converge${respondedNote}; review each view and decide. ` +
        votes.map((v) => `${v.model} (${v.confidence}): ${clip(v.reasoning, 160)}`).join(' | '),
      600
    ),
    consensus_cause: clip(`Models disagree — ${sideBySide}`, 240),
    final_confidence: finalConfidence,
    ...base,
  }
}

/** One provider's vote; null vote on failure/timeout/unparseable output. Always records elapsed_ms. */
async function askOneModel(
  scope: OwnedScope,
  spec: AdvisoryModelSpec,
  facts: string
): Promise<{ vote: AdvisoryModelVote | null; elapsed_ms: number; model: string }> {
  const t0 = Date.now()
  try {
    if (spec.platformId || spec.provider === 'clova') {
      const platformId = spec.platformId ?? `clova:${spec.model.toLowerCase()}`
      const res = await callPlatformModel({
        id: platformId,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: facts,
        maxCompletionTokens: ADVISORY_MAX_COMPLETION_TOKENS,
        timeoutMs: ADVISORY_MODEL_TIMEOUT_MS,
      })
      const elapsed_ms = Date.now() - t0
      const parsed = res.text ? extractJson(res.text) : null
      const advisory = parseDiscrepancyAdvisory(parsed)
      const model = spec.model
      if (!advisory) {
        const kind = res.error ? 'api_error' : !res.text ? 'empty_text' : parsed ? 'advisory_parse_fail' : 'json_extract_fail'
        console.warn(
          `[explain-discrepancy] ${spec.model} vote=null kind=${kind} finishReason=${res.finishReason ?? 'n/a'} elapsed_ms=${elapsed_ms} completionTokens=${res.usage?.completionTokens ?? 'n/a'}`,
          JSON.stringify({ error: res.error ?? null, text: res.text ?? null })
        )
        return { vote: null, elapsed_ms, model }
      }
      if (res.finishReason === 'length' || res.finishReason === 'max_tokens') {
        console.warn(
          `[explain-discrepancy] ${spec.model} finished with ${res.finishReason} completionTokens=${res.usage?.completionTokens ?? 'n/a'} (possible truncate)`
        )
      }
      return {
        vote: {
          model,
          cause: clip(advisory.estimated_cause, 240),
          confidence: advisory.confidence,
          reasoning: clip(advisory.reasoning, 600),
        },
        elapsed_ms,
        model,
      }
    }

    const result = await runSingleAiProvider({
      supabase: supabaseAdmin,
      sessionId: null,
      userId: scope.userId,
      provider: spec.provider as ExtendedAiProviderName,
      modelOverride: spec.model,
      // gpt-5.6-terra rejects temperature=0; claude-sonnet-5 rejects temperature entirely.
      // Omit so each provider uses its default — not a model substitution.
      systemPrompt: SYSTEM_PROMPT,
      prompt: facts,
      maxCompletionTokens: ADVISORY_MAX_COMPLETION_TOKENS,
      skipLanguageInjection: true,
      timeoutMs: ADVISORY_MODEL_TIMEOUT_MS,
    })
    const elapsed_ms = result.responseTimeMs
    const parsed = result.text ? extractJson(result.text) : null
    const advisory = parseDiscrepancyAdvisory(parsed)
    const model = result.model || spec.model
    if (!advisory) {
      // TEMP diagnostic — surface swallowed failures (api error vs empty vs unparseable).
      const kind = result.error
        ? 'api_error'
        : !result.text
          ? 'empty_text'
          : parsed
            ? 'advisory_parse_fail'
            : 'json_extract_fail'
      console.warn(
        `[explain-discrepancy] ${spec.model} vote=null kind=${kind} finishReason=${result.finishReason ?? 'n/a'} elapsed_ms=${elapsed_ms}`,
        JSON.stringify({
          error: result.error ?? null,
          text: result.text ?? null,
          parsed,
        })
      )
      return { vote: null, elapsed_ms, model }
    }
    return {
      vote: {
        model,
        cause: clip(advisory.estimated_cause, 240),
        confidence: advisory.confidence,
        reasoning: clip(advisory.reasoning, 600),
      },
      elapsed_ms,
      model,
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[explain-discrepancy] ${spec.model} THROWN elapsed_ms=${Date.now() - t0}:`, msg)
    return { vote: null, elapsed_ms: Date.now() - t0, model: spec.model }
  }
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
  // Gate: reconciled (대사) methods only. Historically 'card' alone; the
  // Step-2 retype moved delivery apps / foreign pay onto their own codes and
  // ai_confirmed mismatches can carry any reconciled method — all of them
  // settle net-of-fee and deserve the advisory. Settlement-only methods
  // (cash/transfer/paper_voucher) never have amount_mismatch rows at all.
  const channelType =
    channel?.channel_type ??
    (sales[0]?.sale_kind === 'card' || sales.some((s) => s.issuer_id) ? 'card' : null)
  if (!channelType || !(RECONCILED_METHOD_CODES as readonly string[]).includes(channelType)) {
    return dalErr(400, 'discrepancy explanation is only available for reconciled-method mismatches')
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

  // Same strict-JSON prompt to every model, in parallel. askOneModel
  // never throws — failures/timeouts/garbage become a null vote and we
  // aggregate over whoever actually answered.
  const wallStart = Date.now()
  const settled = await Promise.all(
    ADVISORY_MODELS.map((spec) => askOneModel(scope, spec, facts))
  )
  const wall_clock_ms = Date.now() - wallStart
  const model_timings: AdvisoryModelTiming[] = settled.map((s) => ({
    model: s.model,
    elapsed_ms: s.elapsed_ms,
    ok: s.vote !== null,
  }))
  const votes = settled
    .map((s) => s.vote)
    .filter((v): v is AdvisoryModelVote => v !== null)

  if (votes.length === 0) {
    return dalErr(
      502,
      `All ${ADVISORY_MODELS.length} advisory models failed or timed out — no explanation produced`
    )
  }

  const clipped = aggregateVotes(votes, ADVISORY_MODELS.length)

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
    model_timings,
    wall_clock_ms,
  })
}
