import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import type { OwnedScope } from '@/lib/reconciliation/scope'
import { fraction, matchToleranceWon, netWon, ZERO_FEE, type FractionRate } from '@/lib/reconciliation/fees'
import { channelFeeFraction } from '@/lib/reconciliation/channel-rules'
import { alreadyMatchedIds, ruleForChannel } from '@/lib/reconciliation/reconcile'
import { getIssuer, learnMemoAlias } from '@/lib/reconciliation/issuers-db'
import {
  PROPOSAL_STATUSES,
  type CardIssuer,
  type DalResult,
  type DepositRecord,
  type MatchProposal,
  type PaymentChannel,
  type Reconciliation,
  type ReconciliationMatch,
  type SalesRecord,
} from '@/lib/reconciliation/types'

/**
 * Match-proposal DAL — the OWNER-CONFIRMS half of the AI loop (req. 3).
 *
 * A proposal NEVER becomes a reconciliation by itself. The only paths out of
 * 'pending' are:
 *   approve  → re-verify nothing was matched meanwhile (race guard), then
 *              create the reconciliation (source='ai_confirmed') + matches,
 *              and stamp the proposal approved. The owner may EDIT the sale
 *              set first — the edit is stored (approved_sale_ids vs
 *              proposed_sale_ids) and becomes learning context for the next
 *              inference round.
 *   reject   → stamp rejected (+ note). Optionally correct the deposit's
 *              issuer — persisted as issuer_source='user' AND fed to
 *              learnMemoAlias so the same memo resolves for free next time.
 *   supersede→ done by the deterministic engine when it consumes the rows.
 *
 * Approval verdict: |expected net − deposit| within rounding tolerance →
 * 'matched'; beyond it → 'amount_mismatch' (with the residual recorded, so
 * the existing explain-discrepancy advisory can pick it up). Money never
 * gets marked arrived silently — this function only runs on the owner's click.
 */

const PROPOSALS_TABLE = 'reconciliation_match_proposals'
const MIGRATION_HINT =
  'reconciliation_match_proposals 테이블이 없습니다 — Step-2 마이그레이션 SQL(BLOCK 2)을 먼저 실행하세요.'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function dalOk<T>(data: T): DalResult<T> {
  return { ok: true, data }
}
function dalErr(status: number, error: string): DalResult<never> {
  return { ok: false, status, error }
}
function fromSbError(error: { message: string; code?: string }): DalResult<never> {
  if (error.code === '42P01') return dalErr(503, MIGRATION_HINT)
  console.error('[reconciliation:proposals] db error:', error.message)
  return dalErr(500, 'Database error')
}

export type ProposalExpanded = MatchProposal & {
  deposit: Pick<DepositRecord, 'id' | 'deposit_date' | 'actual_amount' | 'memo' | 'issuer_id'> | null
  issuer_name: string | null
  proposed_sales: Pick<SalesRecord, 'id' | 'sale_date' | 'gross_amount' | 'issuer_id' | 'sale_kind'>[]
}

export async function listProposals(
  scope: OwnedScope,
  filters?: { status?: string | null }
): Promise<DalResult<ProposalExpanded[]>> {
  let q = supabaseAdmin
    .from(PROPOSALS_TABLE)
    .select('*')
    .eq('user_id', scope.userId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (filters?.status) {
    if (!(PROPOSAL_STATUSES as readonly string[]).includes(filters.status)) {
      return dalErr(400, `status must be one of: ${PROPOSAL_STATUSES.join(', ')}`)
    }
    q = q.eq('status', filters.status)
  }
  const { data, error } = await q
  if (error) return fromSbError(error)
  const proposals = ((data ?? []) as MatchProposal[]).filter((p) => p.user_id === scope.userId)
  return expandProposals(scope, proposals)
}

export async function getProposal(scope: OwnedScope, id: string): Promise<DalResult<MatchProposal>> {
  if (!UUID_RE.test(id)) return dalErr(400, 'id must be a uuid')
  const { data, error } = await supabaseAdmin
    .from(PROPOSALS_TABLE)
    .select('*')
    .eq('id', id)
    .eq('user_id', scope.userId)
    .maybeSingle()
  if (error) return fromSbError(error)
  if (!data || (data as MatchProposal).user_id !== scope.userId) return dalErr(404, 'Proposal not found')
  return dalOk(data as MatchProposal)
}

async function expandProposals(
  scope: OwnedScope,
  proposals: MatchProposal[]
): Promise<DalResult<ProposalExpanded[]>> {
  if (proposals.length === 0) return dalOk([])
  const depositIds = [...new Set(proposals.map((p) => p.deposit_record_id))]
  const saleIds = [...new Set(proposals.flatMap((p) => p.proposed_sale_ids))]
  const issuerIds = [...new Set(proposals.map((p) => p.issuer_id).filter((v): v is string => v != null))]

  const [depositsRes, salesRes, issuersRes] = await Promise.all([
    supabaseAdmin
      .from('deposit_records')
      .select('id, deposit_date, actual_amount, memo, issuer_id, user_id')
      .eq('user_id', scope.userId)
      .in('id', depositIds),
    saleIds.length > 0
      ? supabaseAdmin
          .from('sales_records')
          .select('id, sale_date, gross_amount, issuer_id, sale_kind, user_id')
          .eq('user_id', scope.userId)
          .in('id', saleIds)
      : Promise.resolve({ data: [], error: null }),
    issuerIds.length > 0
      ? supabaseAdmin
          .from('card_issuers')
          .select('id, name, user_id')
          .eq('user_id', scope.userId)
          .in('id', issuerIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (depositsRes.error) return fromSbError(depositsRes.error)
  if (salesRes.error) return fromSbError(salesRes.error)
  if (issuersRes.error) return fromSbError(issuersRes.error)

  const depositById = new Map(
    ((depositsRes.data ?? []) as (Pick<DepositRecord, 'id' | 'deposit_date' | 'actual_amount' | 'memo' | 'issuer_id'> & { user_id: string })[])
      .filter((d) => d.user_id === scope.userId)
      .map((d) => [d.id, d])
  )
  const saleById = new Map(
    ((salesRes.data ?? []) as (Pick<SalesRecord, 'id' | 'sale_date' | 'gross_amount' | 'issuer_id' | 'sale_kind'> & { user_id: string })[])
      .filter((s) => s.user_id === scope.userId)
      .map((s) => [s.id, s])
  )
  const issuerNameById = new Map(
    ((issuersRes.data ?? []) as { id: string; name: string; user_id: string }[])
      .filter((i) => i.user_id === scope.userId)
      .map((i) => [i.id, i.name])
  )

  return dalOk(
    proposals.map((p) => ({
      ...p,
      deposit: depositById.get(p.deposit_record_id) ?? null,
      issuer_name: p.issuer_id ? (issuerNameById.get(p.issuer_id) ?? null) : null,
      proposed_sales: p.proposed_sale_ids
        .map((id) => saleById.get(id))
        .filter((s): s is NonNullable<typeof s> => s != null),
    }))
  )
}

async function markProposal(
  scope: OwnedScope,
  id: string,
  patch: Record<string, unknown>
): Promise<DalResult<MatchProposal>> {
  const { data, error } = await supabaseAdmin
    .from(PROPOSALS_TABLE)
    .update({ ...patch, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', scope.userId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle()
  if (error) return fromSbError(error)
  if (!data) return dalErr(409, '이미 처리된 제안입니다.')
  return dalOk(data as MatchProposal)
}

export type ApproveResult = {
  proposal: MatchProposal
  reconciliation: Reconciliation & { matches: ReconciliationMatch[] }
  /** issuer-less matched sales that were attributed to the deposit's issuer (learning). */
  sales_attributed_to_issuer: number
}

/**
 * OWNER APPROVES (optionally with an edited sale set). Recomputes the
 * expected net with the AUTHORITATIVE rule (issuer FRACTION rate first —
 * req. F), race-guards against rows matched since the proposal was made,
 * writes the reconciliation with source='ai_confirmed', and back-fills
 * issuer attribution onto matched issuer-less sales (learning).
 */
export async function approveProposal(
  scope: OwnedScope,
  id: string,
  opts?: { saleIds?: string[]; note?: string | null }
): Promise<DalResult<ApproveResult>> {
  const proposalRes = await getProposal(scope, id)
  if (!proposalRes.ok) return proposalRes
  const proposal = proposalRes.data
  if (proposal.status !== 'pending') return dalErr(409, '이미 처리된 제안입니다.')

  // Owner's edit wins over the AI's set — but every id must be a real owned sale.
  const saleIds = [...new Set(opts?.saleIds && opts.saleIds.length > 0 ? opts.saleIds : proposal.proposed_sale_ids)]
  if (saleIds.length === 0) return dalErr(400, '승인할 매출이 없습니다 — 거절을 사용하세요.')
  for (const saleId of saleIds) {
    if (!UUID_RE.test(saleId)) return dalErr(400, 'sale_ids must be uuids')
  }

  const { data: saleRows, error: saleErr } = await supabaseAdmin
    .from('sales_records')
    .select('*')
    .eq('user_id', scope.userId)
    .in('id', saleIds)
  if (saleErr) return fromSbError(saleErr)
  const sales = ((saleRows ?? []) as SalesRecord[]).filter((s) => s.user_id === scope.userId)
  if (sales.length !== saleIds.length) return dalErr(404, '일부 매출을 찾을 수 없습니다.')

  const { data: depositRow, error: depErr } = await supabaseAdmin
    .from('deposit_records')
    .select('*')
    .eq('id', proposal.deposit_record_id)
    .eq('user_id', scope.userId)
    .maybeSingle()
  if (depErr) return fromSbError(depErr)
  const deposit = depositRow as DepositRecord | null
  if (!deposit || deposit.user_id !== scope.userId) return dalErr(404, '입금 기록을 찾을 수 없습니다.')

  // ── race guard: nothing in this set may have been matched meanwhile ───────
  const matchedRes = await alreadyMatchedIds(scope)
  if (!matchedRes.ok) return matchedRes
  if (matchedRes.data.deposits.has(deposit.id)) {
    await markProposal(scope, id, { status: 'superseded' })
    return dalErr(409, '이 입금은 이미 다른 대사에 사용되었습니다 — 제안을 대체 처리했습니다.')
  }
  const takenSale = saleIds.find((sid) => matchedRes.data.sales.has(sid))
  if (takenSale) {
    await markProposal(scope, id, { status: 'superseded' })
    return dalErr(409, '제안된 매출 중 일부가 이미 다른 대사에 사용되었습니다 — 제안을 대체 처리했습니다.')
  }

  // ── authoritative recompute (issuer fraction wins — req. F) ────────────────
  let issuer: CardIssuer | null = null
  if (proposal.issuer_id) {
    const issuerRes = await getIssuer(scope, proposal.issuer_id)
    if (issuerRes.ok) issuer = issuerRes.data
  }
  const channelFeeCache = new Map<string, FractionRate>()
  const feeFor = async (sale: SalesRecord): Promise<FractionRate> => {
    if (sale.issuer_id) {
      const r = await getIssuer(scope, sale.issuer_id)
      if (r.ok) return fraction(r.data.fee_rate)
    }
    if (issuer) return fraction(issuer.fee_rate)
    if (sale.channel_id) {
      const cached = channelFeeCache.get(sale.channel_id)
      if (cached) return cached
      const { data: ch } = await supabaseAdmin
        .from('payment_channels')
        .select('*')
        .eq('id', sale.channel_id)
        .eq('user_id', scope.userId)
        .maybeSingle()
      if (ch) {
        const fee = channelFeeFraction(await ruleForChannel(ch as PaymentChannel))
        channelFeeCache.set(sale.channel_id, fee)
        return fee
      }
    }
    return ZERO_FEE
  }

  let expectedNetTotal = 0
  for (const sale of sales) expectedNetTotal += netWon(sale.gross_amount, await feeFor(sale))
  const residual = expectedNetTotal - deposit.actual_amount
  const tolerance = matchToleranceWon(sales.length)
  const status = Math.abs(residual) <= tolerance ? 'matched' : 'amount_mismatch'

  const edited =
    JSON.stringify([...saleIds].sort()) !== JSON.stringify([...proposal.proposed_sale_ids].sort())
  const reason =
    `AI 제안 승인 (모델 ${proposal.agreement ?? '?'} 일치${edited ? ', 주인이 매출 조합 수정' : ''}) — ` +
    `매출 ${sales.length}건 예상 순입금 ₩${Math.round(expectedNetTotal).toLocaleString('ko-KR')} vs ` +
    `${deposit.deposit_date} 입금 ₩${Math.round(deposit.actual_amount).toLocaleString('ko-KR')}` +
    (status === 'amount_mismatch' ? ` (차액 ₩${Math.round(Math.abs(residual)).toLocaleString('ko-KR')})` : '')

  const base = {
    user_id: scope.userId,
    status,
    discrepancy_amount: status === 'matched' ? 0 : Math.round(residual * 100) / 100,
    discrepancy_reason: reason,
    security_flag: 'none',
    resolved: false,
    issuer_id: proposal.issuer_id,
    method_code: proposal.method_code,
  }
  let inserted = await supabaseAdmin
    .from('reconciliations')
    .insert({ ...base, source: 'ai_confirmed' })
    .select('*')
    .single()
  if (inserted.error && inserted.error.code === '42703') {
    console.warn('[reconciliation:proposals] reconciliations.source missing — run the Step-2 SQL; inserting without it')
    inserted = await supabaseAdmin.from('reconciliations').insert(base).select('*').single()
  }
  if (inserted.error) return fromSbError(inserted.error)
  const recon = inserted.data as Reconciliation
  if (recon.user_id !== scope.userId) return dalErr(500, 'Ownership mismatch')

  const matchRows = sales.map((s) => ({
    reconciliation_id: recon.id,
    sales_record_id: s.id,
    deposit_record_id: deposit.id,
  }))
  const matchIns = await supabaseAdmin.from('reconciliation_matches').insert(matchRows).select('*')
  if (matchIns.error) {
    await supabaseAdmin.from('reconciliations').delete().eq('id', recon.id).eq('user_id', scope.userId)
    return fromSbError(matchIns.error)
  }

  // ── learning: attribute issuer to matched issuer-less sales ────────────────
  let attributed = 0
  if (issuer) {
    const orphanIds = sales.filter((s) => s.issuer_id == null).map((s) => s.id)
    if (orphanIds.length > 0) {
      const { data: upd, error: updErr } = await supabaseAdmin
        .from('sales_records')
        .update({ issuer_id: issuer.id })
        .eq('user_id', scope.userId)
        .in('id', orphanIds)
        .select('id')
      if (updErr) console.warn('[reconciliation:proposals] issuer attribution failed:', updErr.message)
      else attributed = (upd ?? []).length
    }
  }

  const marked = await markProposal(scope, id, {
    status: 'approved',
    approved_sale_ids: saleIds,
    reconciliation_id: recon.id,
    correction_note: opts?.note ?? null,
  })
  if (!marked.ok) {
    // Proposal got decided concurrently AFTER we wrote the reconciliation —
    // roll the reconciliation back to keep exactly one decision.
    await supabaseAdmin.from('reconciliations').delete().eq('id', recon.id).eq('user_id', scope.userId)
    return marked
  }

  return dalOk({
    proposal: marked.data,
    reconciliation: { ...recon, matches: (matchIns.data ?? []) as ReconciliationMatch[] },
    sales_attributed_to_issuer: attributed,
  })
}

export type RejectResult = {
  proposal: MatchProposal
  /** memo alias learned from an issuer correction, if any. */
  learned_alias: string | null
}

/**
 * OWNER REJECTS. The rejection (plus note) is itself learning data — the
 * next inference round sees it in owner_corrections. Optionally the owner
 * also corrects the deposit's ISSUER: persisted as issuer_source='user' and
 * fed to learnMemoAlias so the memo resolves deterministically next time.
 */
export async function rejectProposal(
  scope: OwnedScope,
  id: string,
  opts?: { note?: string | null; correctedIssuerId?: string | null }
): Promise<DalResult<RejectResult>> {
  const proposalRes = await getProposal(scope, id)
  if (!proposalRes.ok) return proposalRes
  if (proposalRes.data.status !== 'pending') return dalErr(409, '이미 처리된 제안입니다.')

  const marked = await markProposal(scope, id, {
    status: 'rejected',
    correction_note: opts?.note ?? null,
  })
  if (!marked.ok) return marked

  let learnedAlias: string | null = null
  if (opts?.correctedIssuerId) {
    const issuerRes = await getIssuer(scope, opts.correctedIssuerId)
    if (!issuerRes.ok) return issuerRes
    const { data: dep, error: depErr } = await supabaseAdmin
      .from('deposit_records')
      .update({ issuer_id: issuerRes.data.id, issuer_confidence: null, issuer_source: 'user' })
      .eq('id', marked.data.deposit_record_id)
      .eq('user_id', scope.userId)
      .select('memo')
      .maybeSingle()
    if (depErr) return fromSbError(depErr)
    const learned = await learnMemoAlias(scope, issuerRes.data.id, (dep as { memo: string | null } | null)?.memo ?? null)
    if (learned.ok) learnedAlias = learned.data.learned
  }

  return dalOk({ proposal: marked.data, learned_alias: learnedAlias })
}
