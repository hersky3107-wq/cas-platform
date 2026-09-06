import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import type { OwnedScope } from '@/lib/reconciliation/scope'
import {
  channelFeeFraction,
  ruleFromRow,
  ruleForChannelType,
  type ChannelRule,
} from '@/lib/reconciliation/channel-rules'
import { fraction } from '@/lib/reconciliation/fees'
import {
  addDaysIso,
  planWindowReconciliations,
  type GroupRule,
  type WindowDepositInput,
  type WindowPlan,
  type WindowSaleInput,
} from '@/lib/reconciliation/plan-issuer'
import { listIssuers, resolveIssuerByAlias } from '@/lib/reconciliation/issuers-db'
import { UNMATCHED_DEPOSIT_AGE_DAYS } from '@/lib/reconciliation/config'
import {
  saleKindExemptFromReconcile,
  RECONCILED_METHOD_CODES,
  SETTLEMENT_ONLY_METHOD_CODES,
  type CardIssuer,
  type DalResult,
  type DepositRecord,
  type PaymentChannel,
  type Reconciliation,
  type ReconciliationMatch,
  type ReconciliationWithMatches,
  type SalesRecord,
} from '@/lib/reconciliation/types'

/**
 * 정산대사기 — UNIFIED deterministic reconciliation engine (Step 2).
 *
 * ONE run covers every RECONCILED method (payment_method_defs.is_reconciled):
 *   card         → matched PER ISSUER (card_issuers): window
 *                  [sale_date, sale_date + settlement_days + window_days],
 *                  net = gross × (1 − fee_rate) with the issuer's FRACTION
 *                  rate. ★card_issuers.fee_rate (fraction) takes precedence
 *                  over any reconciliation_rules percent row — enforced by
 *                  type: the planner only accepts FractionRate (fees.ts).
 *   app_voucher / barcode_pay / delivery_app / foreign_pay / tax_free
 *                → matched per channel with the channel's effective rule
 *                  (percent → fraction through the one sanctioned
 *                  toFraction() converter).
 *
 * ★TRANSFER RECONCILER RETIRED (Step-2 req. D). cash / transfer /
 * paper_voucher are 정산 전용 (settlement-only): their sales are never
 * loaded, never matched, never missing_deposit; transfer-hinted deposits
 * are treated as UNASSIGNED (the old catch-all hint carries no meaning) —
 * they only enter matching if the memo resolves to a card issuer.
 * Existing transfer reconciliation history rows are NOT touched: they
 * remain readable via /api/reconciliation/results; the engine simply stops
 * producing new ones. There is no reconcileTransfers() anymore.
 *
 * DETERMINISTIC FIRST, AI SECOND (req. 4): this engine only writes what is
 * CERTAIN (exact/batch matches inside the window, window-expired
 * missing_deposit, aged candidate-free unmatched_deposit — see
 * plan-issuer.ts). Every deposit it cannot resolve stays OPEN and is
 * reported as the AI inference queue (match-infer.ts), where multi-model
 * reasoning proposes and the OWNER confirms. Rows written here carry
 * source='deterministic'; approved proposals carry source='ai_confirmed'.
 *
 * IDEMPOTENT: already-matched sales/deposits are excluded before planning;
 * re-running creates nothing new. When a deterministic match lands on a
 * deposit/sale that a PENDING AI proposal references, the proposal is
 * marked superseded (deterministic certainty outranks an unconfirmed guess).
 *
 * OWNERSHIP: OwnedScope + user_id filter on every query, as before.
 */

export type ReconcileOptions = {
  from?: string | null
  to?: string | null
  channelId?: string | null
}

export type MethodBreakdown = {
  matched: number
  missing_deposit: number
  unmatched_deposit: number
}

export type ReconcileSummary = {
  created: number
  matched: number
  missing_deposit: number
  /** Deterministic engine never writes amount_mismatch anymore (kept for old-UI shape; always 0). */
  amount_mismatch: number
  unmatched_deposit: number
  sales_considered: number
  deposits_considered: number
  /** Deposits deterministic matching could not resolve — the AI proposal queue. */
  deposits_left_open: number
  /** Unmatched sales whose settlement window is still open (money may still arrive). */
  sales_left_open: number
  /** Deposits whose issuer was resolved for free by a memo alias in this run. */
  issuer_resolved_by_alias: number
  /** Reconciled-method sales that could not be grouped (no issuer, no channel). */
  unassigned_sales: number
  /** Deposits with no issuer and no usable hint — memo-resolve/AI classify territory. */
  unassigned_deposits: number
  /** Pending AI proposals superseded because a deterministic match consumed their rows. */
  superseded_proposals: number
  by_method: Record<string, MethodBreakdown>
  engine: 'deterministic'
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function dalOk<T>(data: T): DalResult<T> {
  return { ok: true, data }
}
function dalErr(status: number, error: string): DalResult<never> {
  return { ok: false, status, error }
}
function fromSbError(error: { message: string; code?: string }): DalResult<never> {
  if (error.code === '42P01') {
    return dalErr(503, '스키마가 아직 준비되지 않았습니다 — Step-1/Step-2 마이그레이션 SQL을 먼저 실행하세요.')
  }
  console.error('[reconciliation:reconcile] db error:', error.message)
  return dalErr(500, 'Database error')
}

/** YYYY-MM-DD in KST — window-expiry decisions must use the store's clock, not UTC. */
export function todayKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
}

// ── method defs ──────────────────────────────────────────────────────────────

/**
 * payment_method_defs.is_reconciled map. Falls back to the in-code constant
 * sets when the defs table is unreadable — the split is spec, not just data.
 */
export async function loadReconciledMethodSet(): Promise<DalResult<Set<string>>> {
  const { data, error } = await supabaseAdmin
    .from('payment_method_defs')
    .select('code, is_reconciled')
  if (error) {
    if (error.code === '42P01') {
      console.warn('[reconciliation:reconcile] payment_method_defs missing — using in-code method split')
      return dalOk(new Set<string>(RECONCILED_METHOD_CODES))
    }
    return fromSbError(error)
  }
  const set = new Set<string>()
  for (const row of (data ?? []) as { code: string; is_reconciled: boolean }[]) {
    if (row.is_reconciled) set.add(row.code)
  }
  // Defensive: settlement-only codes must never be reconciled even if a defs
  // row is edited by hand — the domain split is a product invariant.
  for (const code of SETTLEMENT_ONLY_METHOD_CODES) set.delete(code)
  return dalOk(set)
}

// ── shared loaders ───────────────────────────────────────────────────────────

export async function alreadyMatchedIds(
  scope: OwnedScope
): Promise<DalResult<{ sales: Set<string>; deposits: Set<string> }>> {
  const { data: recons, error: reconErr } = await supabaseAdmin
    .from('reconciliations')
    .select('id')
    .eq('user_id', scope.userId)
  if (reconErr) return fromSbError(reconErr)
  const reconIds = ((recons ?? []) as { id: string }[]).map((r) => r.id)
  const sales = new Set<string>()
  const deposits = new Set<string>()
  if (reconIds.length === 0) return dalOk({ sales, deposits })

  const { data: matches, error: matchErr } = await supabaseAdmin
    .from('reconciliation_matches')
    .select('sales_record_id, deposit_record_id, reconciliation_id')
    .in('reconciliation_id', reconIds)
  if (matchErr) return fromSbError(matchErr)
  for (const m of (matches ?? []) as ReconciliationMatch[]) {
    if (m.sales_record_id) sales.add(m.sales_record_id)
    if (m.deposit_record_id) deposits.add(m.deposit_record_id)
  }
  return dalOk({ sales, deposits })
}

export async function ruleForChannel(channel: PaymentChannel): Promise<ChannelRule> {
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await supabaseAdmin
    .from('reconciliation_rules')
    .select('*')
    .eq('channel_id', channel.id)
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
    .limit(1)
  const row = (data ?? [])[0] as
    | {
        fee_type?: string | null
        fee_rate?: number | null
        settlement_days?: number | null
        tolerance_won?: number | null
        tolerance_days?: number | null
        effective_to?: string | null
      }
    | undefined
  if (row && row.effective_to && row.effective_to < today) {
    return ruleFromRow(null, channel.channel_type)
  }
  return ruleFromRow(row ?? null, channel.channel_type)
}

// ── group construction ───────────────────────────────────────────────────────

const issuerGroupKey = (issuerId: string): string => `issuer:${issuerId}`
const channelGroupKey = (methodCode: string, channelId: string): string =>
  `method:${methodCode}:${channelId}`

type GroupingContext = {
  rulesByGroup: Map<string, GroupRule>
  issuersById: Map<string, CardIssuer>
  channelsById: Map<string, PaymentChannel>
  reconciledMethods: Set<string>
  /** widest settle+window across groups — bounds the date-range extension. */
  maxLagDays: number
}

function buildGroups(
  issuers: CardIssuer[],
  channels: PaymentChannel[],
  channelRules: Map<string, ChannelRule>,
  reconciledMethods: Set<string>
): GroupingContext {
  const rulesByGroup = new Map<string, GroupRule>()
  const issuersById = new Map<string, CardIssuer>()
  const channelsById = new Map<string, PaymentChannel>()
  let maxLagDays = UNMATCHED_DEPOSIT_AGE_DAYS

  for (const issuer of issuers) {
    issuersById.set(issuer.id, issuer)
    const key = issuerGroupKey(issuer.id)
    rulesByGroup.set(key, {
      groupKey: key,
      methodCode: 'card',
      issuerId: issuer.id,
      label: issuer.name,
      fee: fraction(issuer.fee_rate),
      settlementDays: issuer.settlement_days,
      windowDays: issuer.settlement_window_days,
      toleranceWon: 0,
    })
    maxLagDays = Math.max(maxLagDays, issuer.settlement_days + issuer.settlement_window_days)
  }

  for (const channel of channels) {
    channelsById.set(channel.id, channel)
    if (!reconciledMethods.has(channel.channel_type)) continue
    const rule = channelRules.get(channel.id) ?? ruleForChannelType(channel.channel_type)
    if (!rule) continue
    const key = channelGroupKey(channel.channel_type, channel.id)
    rulesByGroup.set(key, {
      groupKey: key,
      methodCode: channel.channel_type,
      issuerId: null,
      label: channel.name,
      fee: channelFeeFraction(rule),
      settlementDays: rule.settlementDays,
      windowDays: rule.toleranceDays,
      toleranceWon: rule.toleranceWon,
    })
    maxLagDays = Math.max(maxLagDays, rule.settlementDays + rule.toleranceDays)
  }

  return { rulesByGroup, issuersById, channelsById, reconciledMethods, maxLagDays }
}

// ── persistence ──────────────────────────────────────────────────────────────

/**
 * Insert one planned reconciliation + its match rows. Written with the
 * Step-2 columns (issuer_id / method_code / source); when the optional
 * `source` column has not been migrated yet (42703), retries without it so
 * the deterministic engine keeps working pre-migration.
 */
async function insertPlanned(
  scope: OwnedScope,
  plan: WindowPlan
): Promise<DalResult<ReconciliationWithMatches>> {
  const base = {
    user_id: scope.userId,
    status: plan.status,
    discrepancy_amount: Math.round(plan.discrepancyAmount * 100) / 100,
    discrepancy_reason: plan.discrepancyReason,
    security_flag: 'none',
    resolved: false,
    issuer_id: plan.issuerId,
    method_code: plan.methodCode,
  }

  let inserted = await supabaseAdmin
    .from('reconciliations')
    .insert({ ...base, source: 'deterministic' })
    .select('*')
    .single()
  if (inserted.error && inserted.error.code === '42703') {
    console.warn('[reconciliation:reconcile] reconciliations.source missing — run the Step-2 SQL; inserting without it')
    inserted = await supabaseAdmin.from('reconciliations').insert(base).select('*').single()
  }
  if (inserted.error) return fromSbError(inserted.error)
  const recon = inserted.data as Reconciliation
  if (recon.user_id !== scope.userId) return dalErr(500, 'Ownership mismatch')

  const rows = plan.pairs
    .filter((p) => p.sale_id || p.deposit_id)
    .map((p) => ({
      reconciliation_id: recon.id,
      sales_record_id: p.sale_id,
      deposit_record_id: p.deposit_id,
    }))

  let matches: ReconciliationMatch[] = []
  if (rows.length > 0) {
    const ins = await supabaseAdmin.from('reconciliation_matches').insert(rows).select('*')
    if (ins.error) {
      await supabaseAdmin
        .from('reconciliations')
        .delete()
        .eq('id', recon.id)
        .eq('user_id', scope.userId)
      return fromSbError(ins.error)
    }
    matches = (ins.data ?? []) as ReconciliationMatch[]
  }
  return dalOk({ ...recon, matches })
}

/**
 * A deterministic match outranks an unconfirmed AI guess: mark pending
 * proposals that reference a just-consumed deposit or sale as superseded.
 * Silently a no-op before the proposals table is migrated.
 */
async function supersedePendingProposals(
  scope: OwnedScope,
  consumedSaleIds: string[],
  consumedDepositIds: string[]
): Promise<number> {
  if (consumedSaleIds.length === 0 && consumedDepositIds.length === 0) return 0
  let superseded = 0
  try {
    if (consumedDepositIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('reconciliation_match_proposals')
        .update({ status: 'superseded', decided_at: new Date().toISOString() })
        .eq('user_id', scope.userId)
        .eq('status', 'pending')
        .in('deposit_record_id', consumedDepositIds)
        .select('id')
      if (error) throw error
      superseded += (data ?? []).length
    }
    if (consumedSaleIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('reconciliation_match_proposals')
        .update({ status: 'superseded', decided_at: new Date().toISOString() })
        .eq('user_id', scope.userId)
        .eq('status', 'pending')
        .overlaps('proposed_sale_ids', consumedSaleIds)
        .select('id')
      if (error) throw error
      superseded += (data ?? []).length
    }
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code !== '42P01') {
      console.warn('[reconciliation:reconcile] supersede proposals failed:', e instanceof Error ? e.message : e)
    }
  }
  return superseded
}

// ── the unified run ──────────────────────────────────────────────────────────

export async function runUnifiedReconcile(
  scope: OwnedScope,
  opts: ReconcileOptions = {}
): Promise<DalResult<{ created: ReconciliationWithMatches[]; summary: ReconcileSummary }>> {
  for (const [k, v] of Object.entries(opts)) {
    if ((k === 'from' || k === 'to') && v != null && !DATE_RE.test(String(v))) {
      return dalErr(400, `${k} must be YYYY-MM-DD`)
    }
  }

  const methodsRes = await loadReconciledMethodSet()
  if (!methodsRes.ok) return methodsRes
  const reconciledMethods = methodsRes.data

  const issuersRes = await listIssuers(scope, { includeInactive: true })
  if (!issuersRes.ok) return issuersRes
  const issuers = issuersRes.data

  const { data: channelRows, error: channelErr } = await supabaseAdmin
    .from('payment_channels')
    .select('*')
    .eq('user_id', scope.userId)
  if (channelErr) return fromSbError(channelErr)
  let channels = ((channelRows ?? []) as PaymentChannel[]).filter((c) => c.user_id === scope.userId)
  if (opts.channelId) {
    // Optional narrowing (legacy API surface): only that channel's method
    // group runs; issuer groups still run — card money has no single channel.
    channels = channels.filter((c) => c.id === opts.channelId)
  }

  const channelRules = new Map<string, ChannelRule>()
  for (const channel of channels) {
    if (!reconciledMethods.has(channel.channel_type)) continue
    channelRules.set(channel.id, await ruleForChannel(channel))
  }

  const ctx = buildGroups(issuers, channels, channelRules, reconciledMethods)

  // ── load sales (range extended backwards so a deposit inside [from,to]
  //    can still see the sales it settles) ────────────────────────────────────
  let salesQ = supabaseAdmin
    .from('sales_records')
    .select('*')
    .eq('user_id', scope.userId)
    .order('sale_date', { ascending: true })
  if (opts.from) salesQ = salesQ.gte('sale_date', addDaysIso(opts.from, -ctx.maxLagDays))
  if (opts.to) salesQ = salesQ.lte('sale_date', opts.to)
  const { data: saleRows, error: salesErr } = await salesQ
  if (salesErr) return fromSbError(salesErr)
  const allSales = ((saleRows ?? []) as SalesRecord[]).filter((s) => s.user_id === scope.userId)

  // ── load deposits (range extended forwards for late settlements) ──────────
  let depositQ = supabaseAdmin
    .from('deposit_records')
    .select('*')
    .eq('user_id', scope.userId)
    .order('deposit_date', { ascending: true })
  if (opts.from) depositQ = depositQ.gte('deposit_date', opts.from)
  if (opts.to) depositQ = depositQ.lte('deposit_date', addDaysIso(opts.to, ctx.maxLagDays))
  const { data: depositRows, error: depositsErr } = await depositQ
  if (depositsErr) return fromSbError(depositsErr)
  const allDeposits = ((depositRows ?? []) as DepositRecord[]).filter(
    (d) => d.user_id === scope.userId
  )

  // ── free issuer resolution: deterministic memo-alias pass (persisted) ─────
  // Only unresolved deposits; AI resolution is a separate, explicit route
  // (resolve-issuers). An alias hit costs nothing and makes the issuer
  // window matching below immediately effective.
  let resolvedByAlias = 0
  const activeIssuers = issuers.filter((i) => i.is_active)
  for (const deposit of allDeposits) {
    if (deposit.issuer_id != null || deposit.issuer_source === 'user') continue
    const hit = resolveIssuerByAlias(deposit.memo, activeIssuers)
    if (!hit) continue
    const { error: upErr } = await supabaseAdmin
      .from('deposit_records')
      .update({ issuer_id: hit.issuer.id, issuer_confidence: 0.95, issuer_source: 'parser' })
      .eq('id', deposit.id)
      .eq('user_id', scope.userId)
    if (upErr) {
      console.warn('[reconciliation:reconcile] alias persist failed:', upErr.message)
      continue
    }
    deposit.issuer_id = hit.issuer.id
    deposit.issuer_confidence = 0.95
    deposit.issuer_source = 'parser'
    resolvedByAlias++
  }

  // ── group assignment ──────────────────────────────────────────────────────
  const plannerSales: WindowSaleInput[] = []
  let unassignedSales = 0
  for (const sale of allSales) {
    if (saleKindExemptFromReconcile(sale.sale_kind)) continue // cash / paper_voucher: 정산 전용
    const channel = sale.channel_id ? ctx.channelsById.get(sale.channel_id) : undefined
    if (sale.issuer_id && ctx.rulesByGroup.has(issuerGroupKey(sale.issuer_id))) {
      plannerSales.push({
        id: sale.id,
        sale_date: sale.sale_date,
        gross_amount: sale.gross_amount,
        groupKey: issuerGroupKey(sale.issuer_id),
      })
      continue
    }
    if (channel && reconciledMethods.has(channel.channel_type)) {
      plannerSales.push({
        id: sale.id,
        sale_date: sale.sale_date,
        gross_amount: sale.gross_amount,
        groupKey: channelGroupKey(channel.channel_type, channel.id),
      })
      continue
    }
    if (channel) continue // settlement-only channel (transfer/cash/paper) — 정산 전용, silently skipped
    unassignedSales++ // reconciled-ish sale with no channel and no issuer — needs classification
  }

  const plannerDeposits: WindowDepositInput[] = []
  let unassignedDeposits = 0
  for (const deposit of allDeposits) {
    if (deposit.issuer_id && ctx.rulesByGroup.has(issuerGroupKey(deposit.issuer_id))) {
      plannerDeposits.push({
        id: deposit.id,
        deposit_date: deposit.deposit_date,
        actual_amount: deposit.actual_amount,
        groupKey: issuerGroupKey(deposit.issuer_id),
      })
      continue
    }
    const hinted = deposit.channel_hint ? ctx.channelsById.get(deposit.channel_hint) : undefined
    if (hinted && reconciledMethods.has(hinted.channel_type)) {
      plannerDeposits.push({
        id: deposit.id,
        deposit_date: deposit.deposit_date,
        actual_amount: deposit.actual_amount,
        groupKey: channelGroupKey(hinted.channel_type, hinted.id),
      })
      continue
    }
    // Unhinted, or hinted at a settlement-only channel (the legacy transfer
    // catch-all hint means nothing now): NOT matched deterministically and
    // NEVER flagged — memo resolution / AI classification decide its nature.
    unassignedDeposits++
  }

  const matchedRes = await alreadyMatchedIds(scope)
  if (!matchedRes.ok) return matchedRes

  const { plans, summary: planSummary } = planWindowReconciliations({
    today: todayKst(),
    rulesByGroup: ctx.rulesByGroup,
    sales: plannerSales,
    deposits: plannerDeposits,
    alreadyMatchedSaleIds: matchedRes.data.sales,
    alreadyMatchedDepositIds: matchedRes.data.deposits,
    unmatchedDepositAgeDays: UNMATCHED_DEPOSIT_AGE_DAYS,
  })

  const created: ReconciliationWithMatches[] = []
  const byMethod: Record<string, MethodBreakdown> = {}
  const consumedSaleIds: string[] = []
  const consumedDepositIds: string[] = []
  for (const plan of plans) {
    const res = await insertPlanned(scope, plan)
    if (!res.ok) return res
    created.push(res.data)
    const bucket = (byMethod[plan.methodCode] ??= {
      matched: 0,
      missing_deposit: 0,
      unmatched_deposit: 0,
    })
    bucket[plan.status]++
    if (plan.status === 'matched') {
      for (const pair of plan.pairs) {
        if (pair.sale_id) consumedSaleIds.push(pair.sale_id)
        if (pair.deposit_id) consumedDepositIds.push(pair.deposit_id)
      }
    }
  }

  const superseded = await supersedePendingProposals(scope, consumedSaleIds, consumedDepositIds)

  const summary: ReconcileSummary = {
    created: created.length,
    matched: planSummary.matched,
    missing_deposit: planSummary.missing_deposit,
    amount_mismatch: 0,
    unmatched_deposit: planSummary.unmatched_deposit,
    sales_considered: planSummary.sales_considered,
    deposits_considered: planSummary.deposits_considered,
    deposits_left_open: planSummary.deposits_left_open_for_ai,
    sales_left_open: planSummary.sales_left_open,
    issuer_resolved_by_alias: resolvedByAlias,
    unassigned_sales: unassignedSales,
    unassigned_deposits: unassignedDeposits,
    superseded_proposals: superseded,
    by_method: byMethod,
    engine: 'deterministic',
  }
  return dalOk({ created, summary })
}
