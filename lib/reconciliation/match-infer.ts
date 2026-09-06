import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import type { OwnedScope } from '@/lib/reconciliation/scope'
import { askModelsJson } from '@/lib/reconciliation/ai-ask'
import {
  ADVISORY_MODELS,
  INFER_MAX_CANDIDATES_PER_DEPOSIT,
  INFER_MAX_COMPLETION_TOKENS,
  INFER_MAX_CORRECTIONS_SHOWN,
  INFER_MAX_DEPOSITS_PER_RUN,
} from '@/lib/reconciliation/config'
import { channelFeeFraction } from '@/lib/reconciliation/channel-rules'
import { fraction, matchToleranceWon, netWon, ZERO_FEE, type FractionRate } from '@/lib/reconciliation/fees'
import { addDaysIso } from '@/lib/reconciliation/plan-issuer'
import { listIssuers } from '@/lib/reconciliation/issuers-db'
import { alreadyMatchedIds, loadReconciledMethodSet, ruleForChannel } from '@/lib/reconciliation/reconcile'
import {
  saleKindExemptFromReconcile,
  type AdvisoryConfidence,
  type CardIssuer,
  type DalResult,
  type DepositRecord,
  type MatchProposal,
  type PaymentChannel,
  type ProposalModelVote,
  type SalesRecord,
} from '@/lib/reconciliation/types'

/**
 * MATCH INFERENCE — the heart of the Step-2 AI layer (req. c).
 *
 * "Which set of sales does this deposit represent?" has no deterministic
 * answer when deposits batch multiple days, refunds net inside batches and
 * issuers lag differently. So:
 *
 *   1. DETERMINISTIC PRE-FILTER builds a BOUNDED candidate set per unmatched
 *      deposit — same issuer (or issuer-unresolved sales), sale_date within
 *      [deposit_date − (settlement_days + settlement_window_days),
 *      deposit_date], not already matched, not referenced by another pending
 *      proposal. Hard caps: ≤ INFER_MAX_DEPOSITS_PER_RUN deposits per run,
 *      ≤ INFER_MAX_CANDIDATES_PER_DEPOSIT candidate sales per deposit, each
 *      encoded as one compact JSON row keyed "S1".."S40". Models never see
 *      the whole table — token cost and hallucination surface stay bounded.
 *
 *   2. MULTI-MODEL CROSS-CHECK: every ADVISORY_MODELS model (GPT-5.6 Terra +
 *      Claude Sonnet 5 + Mistral Medium 3.5 — US/EU-hosted only) answers the
 *      identical prompt independently. Identical sale-sets from all models →
 *      high confidence; majority → medium (minority view kept visible);
 *      no majority → low, with every reading stored side by side. One
 *      model's answer never becomes fact.
 *
 *   3. AI PROPOSES, THE OWNER CONFIRMS: the output is a PROPOSAL row
 *      (reconciliation_match_proposals) with reasoning + per-model votes,
 *      NEVER a reconciliation. proposals-db.ts turns an approval into the
 *      actual reconciliation (source='ai_confirmed'). High-confidence
 *      unanimous proposals may be pre-checked in the UI — the owner clicks.
 *
 *   4. Hallucination guards: sale keys outside the candidate set are dropped
 *      before voting; a proposal whose residual exceeds
 *      max(5% of the deposit, 3× rounding tolerance) is demoted one
 *      confidence level with the residual spelled out.
 *
 *   5. LEARNING: recent owner decisions (rejections / approve-with-edit,
 *      with correction notes) for the same issuer are included in the
 *      prompt so the models see what the owner already taught.
 */

export type InferSkip = {
  deposit_id: string
  reason: 'no_candidates' | 'ai_no_match' | 'all_models_failed' | 'proposal_exists'
  detail: string
}

export type InferResult = {
  proposals: MatchProposal[]
  skipped: InferSkip[]
  deposits_considered: number
  model_timings: { model: string; elapsed_ms: number; ok: boolean }[]
  bounds: {
    max_deposits_per_run: number
    max_candidates_per_deposit: number
    models: number
  }
}

function dalOk<T>(data: T): DalResult<T> {
  return { ok: true, data }
}
function dalErr(status: number, error: string): DalResult<never> {
  return { ok: false, status, error }
}

const PROPOSALS_TABLE = 'reconciliation_match_proposals'

const MIGRATION_HINT =
  'reconciliation_match_proposals 테이블이 없습니다 — Step-2 마이그레이션 SQL(BLOCK 2)을 먼저 실행하세요.'

const SYSTEM_PROMPT = [
  'You reconcile a Korean store\'s card/PG settlement deposits against its sales records.',
  'You get ONE bank deposit and a bounded list of candidate sales (each with a key like "S1").',
  'Card companies deposit NET of a per-issuer fee, often batching several days of sales into one deposit; refunds are NEGATIVE sales netted inside the batch; settlement lag differs per issuer.',
  'Decide which combination of candidate sales this deposit represents.',
  'Rules: use ONLY the provided candidate keys; the sum of expected_net over your chosen set should be close to the deposit amount (small rounding gaps of a few won are normal; fee-rate drift can explain slightly larger gaps).',
  'If no combination plausibly matches, answer with an empty list — do NOT force a match.',
  'Respond with ONLY compact JSON, no prose:',
  '{"sale_keys":["S1","S3"],"confidence":"high"|"medium"|"low","reasoning":"<1-3 sentences in Korean citing the numbers>"}',
].join(' ')

type CandidateRow = {
  key: string
  sale: SalesRecord
  expectedNet: number
}

type DecidedCorrection = {
  deposit_amount: number
  outcome: string
  note: string | null
}

function confidenceDown(level: AdvisoryConfidence): AdvisoryConfidence {
  if (level === 'high') return 'medium'
  return 'low'
}

/** Fee used to SHOW expected net per candidate (authoritative recompute happens at approval). */
function candidateFee(
  sale: SalesRecord,
  depositIssuer: CardIssuer | null,
  issuersById: Map<string, CardIssuer>,
  channelFees: Map<string, FractionRate>
): FractionRate {
  if (sale.issuer_id) {
    const issuer = issuersById.get(sale.issuer_id)
    if (issuer) return fraction(issuer.fee_rate)
  }
  if (depositIssuer) return fraction(depositIssuer.fee_rate)
  if (sale.channel_id) {
    const fee = channelFees.get(sale.channel_id)
    if (fee) return fee
  }
  return ZERO_FEE
}

export async function inferMatchProposals(
  scope: OwnedScope,
  opts?: { depositIds?: string[] }
): Promise<DalResult<InferResult>> {
  // Probe the proposals table first — a clear 503 beats twelve cryptic errors.
  {
    const probe = await supabaseAdmin.from(PROPOSALS_TABLE).select('id').limit(1)
    if (probe.error) {
      if (probe.error.code === '42P01') return dalErr(503, MIGRATION_HINT)
      console.error('[reconciliation:infer] probe error:', probe.error.message)
      return dalErr(500, 'Database error')
    }
  }

  const methodsRes = await loadReconciledMethodSet()
  if (!methodsRes.ok) return methodsRes
  const reconciledMethods = methodsRes.data

  const issuersRes = await listIssuers(scope, { includeInactive: true })
  if (!issuersRes.ok) return issuersRes
  const issuersById = new Map<string, CardIssuer>()
  let maxLagDays = 7
  for (const issuer of issuersRes.data) {
    issuersById.set(issuer.id, issuer)
    maxLagDays = Math.max(maxLagDays, issuer.settlement_days + issuer.settlement_window_days)
  }

  const { data: channelRows, error: channelErr } = await supabaseAdmin
    .from('payment_channels')
    .select('*')
    .eq('user_id', scope.userId)
  if (channelErr) {
    console.error('[reconciliation:infer] channels error:', channelErr.message)
    return dalErr(500, 'Database error')
  }
  const channels = ((channelRows ?? []) as PaymentChannel[]).filter((c) => c.user_id === scope.userId)
  const channelsById = new Map(channels.map((c) => [c.id, c]))
  const channelFees = new Map<string, FractionRate>()
  for (const channel of channels) {
    if (!reconciledMethods.has(channel.channel_type)) continue
    channelFees.set(channel.id, channelFeeFraction(await ruleForChannel(channel)))
  }

  const matchedRes = await alreadyMatchedIds(scope)
  if (!matchedRes.ok) return matchedRes

  // Pending proposals: their deposit gets no second proposal; their proposed
  // sales are off-limits to new candidate sets (no double-spend of a sale
  // across two open proposals).
  const { data: pendingRows, error: pendingErr } = await supabaseAdmin
    .from(PROPOSALS_TABLE)
    .select('deposit_record_id, proposed_sale_ids')
    .eq('user_id', scope.userId)
    .eq('status', 'pending')
  if (pendingErr) {
    console.error('[reconciliation:infer] pending error:', pendingErr.message)
    return dalErr(500, 'Database error')
  }
  const pendingDepositIds = new Set<string>()
  const pendingSaleIds = new Set<string>()
  for (const row of (pendingRows ?? []) as { deposit_record_id: string; proposed_sale_ids: string[] }[]) {
    pendingDepositIds.add(row.deposit_record_id)
    for (const id of row.proposed_sale_ids ?? []) pendingSaleIds.add(id)
  }

  // ── target deposits: unmatched, method-eligible, newest first, capped ──────
  const { data: depositRows, error: depositErr } = await supabaseAdmin
    .from('deposit_records')
    .select('*')
    .eq('user_id', scope.userId)
    .order('deposit_date', { ascending: false })
    .limit(400)
  if (depositErr) {
    console.error('[reconciliation:infer] deposits error:', depositErr.message)
    return dalErr(500, 'Database error')
  }
  const requestedIds = opts?.depositIds ? new Set(opts.depositIds) : null
  const skipped: InferSkip[] = []
  const targets: DepositRecord[] = []
  for (const row of (depositRows ?? []) as DepositRecord[]) {
    if (row.user_id !== scope.userId) continue
    if (requestedIds && !requestedIds.has(row.id)) continue
    if (matchedRes.data.deposits.has(row.id)) continue
    if (pendingDepositIds.has(row.id)) {
      if (requestedIds) {
        skipped.push({
          deposit_id: row.id,
          reason: 'proposal_exists',
          detail: '이미 대기 중인 제안이 있습니다 — 먼저 승인/거절하세요.',
        })
      }
      continue
    }
    const hinted = row.channel_hint ? channelsById.get(row.channel_hint) : undefined
    const methodEligible =
      row.issuer_id != null || (hinted != null && reconciledMethods.has(hinted.channel_type)) || hinted == null
    if (!methodEligible) continue
    targets.push(row)
    if (targets.length >= INFER_MAX_DEPOSITS_PER_RUN) break
  }

  // ── candidate sales pool (one query, then per-deposit filtering) ───────────
  const { data: saleRows, error: saleErr } = await supabaseAdmin
    .from('sales_records')
    .select('*')
    .eq('user_id', scope.userId)
    .order('sale_date', { ascending: true })
  if (saleErr) {
    console.error('[reconciliation:infer] sales error:', saleErr.message)
    return dalErr(500, 'Database error')
  }
  const openSales = ((saleRows ?? []) as SalesRecord[]).filter((s) => {
    if (s.user_id !== scope.userId) return false
    if (matchedRes.data.sales.has(s.id)) return false
    if (pendingSaleIds.has(s.id)) return false
    if (saleKindExemptFromReconcile(s.sale_kind)) return false
    if (s.gross_amount === 0) return false
    const channel = s.channel_id ? channelsById.get(s.channel_id) : undefined
    if (channel && !reconciledMethods.has(channel.channel_type)) return false // 정산 전용
    return true
  })

  // ── learning context: recent owner decisions ───────────────────────────────
  const { data: decidedRows } = await supabaseAdmin
    .from(PROPOSALS_TABLE)
    .select('issuer_id, deposit_amount, status, correction_note, proposed_sale_ids, approved_sale_ids')
    .eq('user_id', scope.userId)
    .in('status', ['approved', 'rejected'])
    .order('decided_at', { ascending: false })
    .limit(50)
  const decided = (decidedRows ?? []) as {
    issuer_id: string | null
    deposit_amount: number
    status: string
    correction_note: string | null
    proposed_sale_ids: string[]
    approved_sale_ids: string[] | null
  }[]

  const correctionsFor = (issuerId: string | null): DecidedCorrection[] => {
    const relevant = decided.filter((d) => {
      if (d.status === 'rejected' || d.correction_note) return issuerId == null || d.issuer_id === issuerId
      const edited =
        d.approved_sale_ids != null &&
        JSON.stringify([...d.approved_sale_ids].sort()) !== JSON.stringify([...d.proposed_sale_ids].sort())
      return edited && (issuerId == null || d.issuer_id === issuerId)
    })
    return relevant.slice(0, INFER_MAX_CORRECTIONS_SHOWN).map((d) => ({
      deposit_amount: d.deposit_amount,
      outcome:
        d.status === 'rejected'
          ? '주인이 제안을 거절함'
          : '주인이 제안을 수정하여 승인함 (제안한 매출 조합이 틀렸음)',
      note: d.correction_note,
    }))
  }

  const result: InferResult = {
    proposals: [],
    skipped,
    deposits_considered: targets.length,
    model_timings: [],
    bounds: {
      max_deposits_per_run: INFER_MAX_DEPOSITS_PER_RUN,
      max_candidates_per_deposit: INFER_MAX_CANDIDATES_PER_DEPOSIT,
      models: ADVISORY_MODELS.length,
    },
  }

  // Sales proposed within THIS run are also off-limits to later deposits.
  const proposedThisRun = new Set<string>()

  for (const deposit of targets) {
    const depositIssuer = deposit.issuer_id ? (issuersById.get(deposit.issuer_id) ?? null) : null
    const windowDays = depositIssuer
      ? depositIssuer.settlement_days + depositIssuer.settlement_window_days
      : maxLagDays
    const windowStart = addDaysIso(deposit.deposit_date, -windowDays)

    // Pre-filter (req. 1): same issuer OR issuer-unresolved, inside the window.
    const hintedChannelId =
      deposit.channel_hint && channelsById.get(deposit.channel_hint) &&
      reconciledMethods.has(channelsById.get(deposit.channel_hint)!.channel_type)
        ? deposit.channel_hint
        : null

    let candidates = openSales.filter((s) => {
      if (proposedThisRun.has(s.id)) return false
      if (s.sale_date < windowStart || s.sale_date > deposit.deposit_date) return false
      if (depositIssuer) return s.issuer_id === depositIssuer.id || s.issuer_id == null
      if (hintedChannelId) return s.channel_id === hintedChannelId || s.issuer_id != null || s.channel_id == null
      return true // unresolved deposit: any open reconciled sale in the window
    })
    if (candidates.length > INFER_MAX_CANDIDATES_PER_DEPOSIT) {
      // Keep the dates nearest the deposit (most plausible settlement-wise).
      candidates = [...candidates]
        .sort((a, b) => b.sale_date.localeCompare(a.sale_date))
        .slice(0, INFER_MAX_CANDIDATES_PER_DEPOSIT)
        .sort((a, b) => a.sale_date.localeCompare(b.sale_date))
    }
    if (candidates.length === 0) {
      result.skipped.push({
        deposit_id: deposit.id,
        reason: 'no_candidates',
        detail: `창(${windowStart}~${deposit.deposit_date}) 안에 매칭 후보 매출이 없습니다.`,
      })
      continue
    }

    const rows: CandidateRow[] = candidates.map((sale, i) => ({
      key: `S${i + 1}`,
      sale,
      expectedNet: netWon(sale.gross_amount, candidateFee(sale, depositIssuer, issuersById, channelFees)),
    }))
    const byKey = new Map(rows.map((r) => [r.key, r]))

    const userPrompt = JSON.stringify({
      deposit: {
        date: deposit.deposit_date,
        amount: deposit.actual_amount,
        memo: deposit.memo,
        issuer: depositIssuer?.name ?? null,
      },
      issuer_rule: depositIssuer
        ? {
            name: depositIssuer.name,
            fee_fraction: depositIssuer.fee_rate,
            settlement_days: depositIssuer.settlement_days,
            window_days: depositIssuer.settlement_window_days,
          }
        : null,
      candidates: rows.map((r) => ({
        key: r.key,
        date: r.sale.sale_date,
        gross: r.sale.gross_amount,
        expected_net: r.expectedNet,
        issuer: r.sale.issuer_id ? (issuersById.get(r.sale.issuer_id)?.name ?? null) : null,
        refund: r.sale.gross_amount < 0 || undefined,
      })),
      owner_corrections: correctionsFor(deposit.issuer_id),
    })

    const answers = await askModelsJson(
      scope,
      ADVISORY_MODELS,
      SYSTEM_PROMPT,
      userPrompt,
      INFER_MAX_COMPLETION_TOKENS
    )
    for (const a of answers) {
      result.model_timings.push({ model: a.model, elapsed_ms: a.elapsed_ms, ok: a.ok })
    }

    // ── parse per-model votes (hallucinated keys dropped) ────────────────────
    const votes: ProposalModelVote[] = []
    for (const answer of answers) {
      if (!answer.json || typeof answer.json !== 'object' || Array.isArray(answer.json)) continue
      const obj = answer.json as Record<string, unknown>
      const keysRaw = Array.isArray(obj.sale_keys) ? obj.sale_keys : null
      if (!keysRaw) continue
      const ids = new Set<string>()
      for (const k of keysRaw) {
        const row = typeof k === 'string' ? byKey.get(k.trim().toUpperCase()) : undefined
        if (row) ids.add(row.sale.id)
      }
      const conf =
        obj.confidence === 'high' || obj.confidence === 'medium' || obj.confidence === 'low'
          ? obj.confidence
          : 'low'
      votes.push({
        model: answer.model,
        sale_ids: [...ids].sort(),
        confidence: conf,
        reasoning: typeof obj.reasoning === 'string' ? obj.reasoning.slice(0, 600) : '',
      })
    }

    if (votes.length === 0) {
      result.skipped.push({
        deposit_id: deposit.id,
        reason: 'all_models_failed',
        detail: '모든 모델이 응답하지 않았습니다 — 다시 시도하세요.',
      })
      continue
    }

    // ── cross-check: identical sale-ID SETS agree, anything else diverges ────
    const setTally = new Map<string, { ids: string[]; count: number; votes: ProposalModelVote[] }>()
    for (const vote of votes) {
      const key = vote.sale_ids.join(',')
      const entry = setTally.get(key) ?? { ids: vote.sale_ids, count: 0, votes: [] }
      entry.count++
      entry.votes.push(vote)
      setTally.set(key, entry)
    }
    let winner = [...setTally.values()].sort((a, b) => b.count - a.count)[0]!
    if (winner.ids.length === 0) {
      // The plurality says "no match here". Prefer a non-empty minority only
      // if it strictly outnumbers... it can't (plurality). Consensus no-match:
      const nonEmpty = [...setTally.values()].filter((e) => e.ids.length > 0)
      if (nonEmpty.length === 0 || winner.count > Math.max(...nonEmpty.map((e) => e.count))) {
        result.skipped.push({
          deposit_id: deposit.id,
          reason: 'ai_no_match',
          detail: `모델 ${winner.count}/${votes.length}이(가) 후보 중에 이 입금의 매출 조합이 없다고 판단했습니다.`,
        })
        continue
      }
      winner = nonEmpty.sort((a, b) => b.count - a.count)[0]!
    }

    let confidence: AdvisoryConfidence
    if (winner.count === votes.length && votes.length >= 2) confidence = 'high'
    else if (winner.count * 2 > votes.length) confidence = 'medium'
    else confidence = 'low'
    const agreement = `${winner.count}/${votes.length}`

    // ── residual sanity (hallucination guard) ────────────────────────────────
    const chosen = rows.filter((r) => winner.ids.includes(r.sale.id))
    const expectedNetTotal = chosen.reduce((sum, r) => sum + r.expectedNet, 0)
    const residual = expectedNetTotal - deposit.actual_amount
    const residualLimit = Math.max(
      Math.abs(deposit.actual_amount) * 0.05,
      3 * matchToleranceWon(chosen.length)
    )
    let residualNote = ''
    if (Math.abs(residual) > residualLimit) {
      confidence = confidenceDown(confidence)
      residualNote = ` [주의: 예상 순입금 합계와 실제 입금이 ₩${Math.round(Math.abs(residual)).toLocaleString('ko-KR')} 차이 — 신뢰도 하향]`
    }

    const representative =
      winner.votes.find((v) => v.reasoning.length > 0)?.reasoning ?? '모델 합의'
    const minorityViews = votes
      .filter((v) => v.sale_ids.join(',') !== winner.ids.join(','))
      .map((v) => `${v.model}: [${v.sale_ids.length}건] ${v.reasoning.slice(0, 160)}`)
    const reasoning =
      `[${agreement} 모델 일치] ${representative}` +
      residualNote +
      (minorityViews.length > 0 ? ` | 소수 의견 — ${minorityViews.join(' / ')}` : '')

    // Issuer/method attribution for the proposal row.
    const chosenIssuerIds = new Set(
      chosen.map((r) => r.sale.issuer_id).filter((v): v is string => v != null)
    )
    const proposalIssuerId =
      deposit.issuer_id ?? (chosenIssuerIds.size === 1 ? [...chosenIssuerIds][0]! : null)
    const hinted = hintedChannelId ? channelsById.get(hintedChannelId) : undefined
    const methodCode = proposalIssuerId ? 'card' : (hinted?.channel_type ?? null)

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from(PROPOSALS_TABLE)
      .insert({
        user_id: scope.userId,
        deposit_record_id: deposit.id,
        issuer_id: proposalIssuerId,
        method_code: methodCode,
        proposed_sale_ids: winner.ids,
        expected_net_total: expectedNetTotal,
        deposit_amount: deposit.actual_amount,
        residual_won: residual,
        confidence,
        agreement,
        per_model: votes,
        reasoning: reasoning.slice(0, 2000),
        status: 'pending',
      })
      .select('*')
      .single()
    if (insErr) {
      if (insErr.code === '23505') {
        result.skipped.push({
          deposit_id: deposit.id,
          reason: 'proposal_exists',
          detail: '동시 실행으로 이미 제안이 생성되었습니다.',
        })
        continue
      }
      if (insErr.code === '42P01') return dalErr(503, MIGRATION_HINT)
      console.error('[reconciliation:infer] insert error:', insErr.message)
      return dalErr(500, 'Database error')
    }
    for (const id of winner.ids) proposedThisRun.add(id)
    result.proposals.push(inserted as MatchProposal)
  }

  return dalOk(result)
}
