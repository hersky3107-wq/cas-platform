import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import type { OwnedScope } from '@/lib/reconciliation/scope'
import {
  expectedDepositDate,
  expectedNet,
  ruleFromRow,
  TRANSFER_RULE,
  type ChannelRule,
} from '@/lib/reconciliation/channel-rules'
import type {
  DalResult,
  DepositRecord,
  PaymentChannel,
  Reconciliation,
  ReconciliationMatch,
  ReconciliationWithMatches,
  ReconStatus,
  SalesRecord,
} from '@/lib/reconciliation/types'

/**
 * 대사기 — transfer reconciliation engine (STAGE 1).
 *
 * SCOPE: bank-transfer channels only. Transfer = 0 fee, same-day settlement,
 * so expected_net = gross and expected_deposit_date = sale_date. Any channel
 * whose channel_type !== 'transfer' is ignored here.
 *
 * OWNERSHIP: takes OwnedScope from withOwnedScope() and filters every query by
 * user_id = scope.userId. supabaseAdmin bypasses RLS; this is the auth gate.
 *
 * ALGORITHM (per expected-settlement date):
 *   1. exact 1:1 amount matches → one `matched` reconciliation each,
 *   2. remainder sales+deposits → one batch reconciliation:
 *        sums equal (within tolerance) → matched, else amount_mismatch (N:M),
 *   3. remainder sales, no deposit → missing_deposit,
 *   4. remainder deposits, no sale → left OPEN (unmatched_deposit is out of scope).
 *
 * IDEMPOTENT: sales/deposits already referenced by a reconciliation_matches row
 * are excluded, so re-running does not double-create.
 *
 * This module is split into:
 *   - planTransferReconciliations(): PURE decision logic. Takes plain arrays +
 *     a rule map + already-matched id sets, returns what *would* be created.
 *     No supabase, no I/O — this is what unit tests exercise directly.
 *   - reconcileTransfers(): orchestrator. Does the I/O (load channels/rules/
 *     open rows, then persist each planned reconciliation) and delegates all
 *     matching decisions to the pure planner above.
 */

export type ReconcileOptions = {
  from?: string | null
  to?: string | null
  channelId?: string | null
}

export type ReconcileSummary = {
  created: number
  matched: number
  missing_deposit: number
  amount_mismatch: number
  sales_considered: number
  deposits_considered: number
  deposits_left_open: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const AMOUNT_EPSILON = 0.005

function dalOk<T>(data: T): DalResult<T> {
  return { ok: true, data }
}
function dalErr(status: number, error: string): DalResult<never> {
  return { ok: false, status, error }
}
function fromSbError(error: { message: string }): DalResult<never> {
  console.error('[reconciliation:reconcile] db error:', error.message)
  return dalErr(500, 'Database error')
}

export type MatchPair = { sale_id: string | null; deposit_id: string | null }

export type PlannedReconciliation = {
  status: ReconStatus
  discrepancyAmount: number
  discrepancyReason: string | null
  pairs: MatchPair[]
}

export type PlanSummary = Omit<ReconcileSummary, 'created'>

/** Minimal shape the pure planner needs from a sales_records row. */
export type PlannerSaleInput = Pick<
  SalesRecord,
  'id' | 'sale_date' | 'gross_amount' | 'expected_net_amount' | 'channel_id'
>

/** Minimal shape the pure planner needs from a deposit_records row. */
export type PlannerDepositInput = Pick<
  DepositRecord,
  'id' | 'deposit_date' | 'actual_amount' | 'channel_hint'
>

export type PlanTransfersInput = {
  sales: readonly PlannerSaleInput[]
  deposits: readonly PlannerDepositInput[]
  /** channel_id -> effective ChannelRule. Missing entries fall back to TRANSFER_RULE. */
  ruleByChannelId?: ReadonlyMap<string, ChannelRule>
  /** sales_record ids already linked by an existing reconciliation_matches row. */
  alreadyMatchedSaleIds?: ReadonlySet<string>
  /** deposit_record ids already linked by an existing reconciliation_matches row. */
  alreadyMatchedDepositIds?: ReadonlySet<string>
}

function groupByDate<T extends { [k: string]: unknown }>(rows: T[], key: keyof T): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const d = String(row[key])
    const list = map.get(d) ?? []
    list.push(row)
    map.set(d, list)
  }
  return map
}

/**
 * PURE matching engine. No supabase, no async — given already-loaded sales
 * and deposits (plus optional rule/already-matched inputs), returns exactly
 * what reconciliations *would* be created and a summary of the run.
 *
 * Idempotency is enforced right here: rows whose id is in
 * alreadyMatchedSaleIds / alreadyMatchedDepositIds are excluded up front, so
 * re-running with the same already-matched sets never re-plans them.
 */
export function planTransferReconciliations(
  input: PlanTransfersInput
): { plans: PlannedReconciliation[]; summary: PlanSummary } {
  const ruleByChannelId = input.ruleByChannelId ?? new Map<string, ChannelRule>()
  const matchedSaleIds = input.alreadyMatchedSaleIds ?? new Set<string>()
  const matchedDepositIds = input.alreadyMatchedDepositIds ?? new Set<string>()

  const sales = input.sales.filter((s) => !matchedSaleIds.has(s.id))
  const deposits = input.deposits.filter((d) => !matchedDepositIds.has(d.id))

  const plans: PlannedReconciliation[] = []
  const summary: PlanSummary = {
    matched: 0,
    missing_deposit: 0,
    amount_mismatch: 0,
    sales_considered: sales.length,
    deposits_considered: deposits.length,
    deposits_left_open: 0,
  }

  const ruleFor = (sale: PlannerSaleInput): ChannelRule =>
    (sale.channel_id && ruleByChannelId.get(sale.channel_id)) || TRANSFER_RULE
  const netOf = (sale: PlannerSaleInput): number =>
    sale.expected_net_amount != null ? sale.expected_net_amount : expectedNet(sale.gross_amount, ruleFor(sale))
  const toleranceOf = (sale: PlannerSaleInput): number => ruleFor(sale).toleranceWon

  // Index sales by their EXPECTED deposit date (transfer = same day), deposits by actual date.
  const salesByExpected = new Map<string, PlannerSaleInput[]>()
  for (const sale of sales) {
    const expDate = expectedDepositDate(sale.sale_date, ruleFor(sale))
    const list = salesByExpected.get(expDate) ?? []
    list.push(sale)
    salesByExpected.set(expDate, list)
  }
  const depositsByDate = groupByDate(deposits as PlannerDepositInput[], 'deposit_date')

  const allDates = new Set<string>([...salesByExpected.keys(), ...depositsByDate.keys()])

  for (const date of Array.from(allDates).sort()) {
    const dateSales = [...(salesByExpected.get(date) ?? [])]
    const dateDeposits = [...(depositsByDate.get(date) ?? [])]

    // ── pass 1: exact 1:1 amount matches ────────────────────────────────────
    const depositUsed = new Set<string>()
    for (const sale of [...dateSales]) {
      const target = netOf(sale)
      const tol = toleranceOf(sale)
      const hit = dateDeposits.find(
        (d) => !depositUsed.has(d.id) && Math.abs(d.actual_amount - target) <= Math.max(tol, AMOUNT_EPSILON)
      )
      if (!hit) continue
      depositUsed.add(hit.id)
      const idx = dateSales.indexOf(sale)
      if (idx >= 0) dateSales.splice(idx, 1)
      plans.push({
        status: 'matched',
        discrepancyAmount: 0,
        discrepancyReason: null,
        pairs: [{ sale_id: sale.id, deposit_id: hit.id }],
      })
      summary.matched++
    }
    const remDeposits = dateDeposits.filter((d) => !depositUsed.has(d.id))

    // ── pass 2: batch remainder (N sales ↔ N deposits) ──────────────────────
    if (dateSales.length > 0 && remDeposits.length > 0) {
      const expectedSum = dateSales.reduce((sum, s) => sum + netOf(s), 0)
      const actualSum = remDeposits.reduce((sum, d) => sum + d.actual_amount, 0)
      const diff = Math.round((expectedSum - actualSum) * 100) / 100
      const tol = Math.max(...dateSales.map(toleranceOf), 0)
      const pairs: MatchPair[] = []
      for (const s of dateSales) {
        for (const d of remDeposits) pairs.push({ sale_id: s.id, deposit_id: d.id })
      }
      if (Math.abs(diff) <= Math.max(tol, AMOUNT_EPSILON)) {
        plans.push({
          status: 'matched',
          discrepancyAmount: 0,
          discrepancyReason: `batch: ${dateSales.length} sale(s) ↔ ${remDeposits.length} deposit(s) on ${date}`,
          pairs,
        })
        summary.matched++
      } else {
        plans.push({
          status: 'amount_mismatch',
          discrepancyAmount: diff,
          discrepancyReason: `expected ${expectedSum} vs received ${actualSum} on ${date}`,
          pairs,
        })
        summary.amount_mismatch++
      }
    } else if (dateSales.length > 0) {
      // ── pass 3: sales with no deposit → missing_deposit ───────────────────
      const expectedSum = dateSales.reduce((sum, s) => sum + netOf(s), 0)
      const pairs: MatchPair[] = dateSales.map((s) => ({ sale_id: s.id, deposit_id: null }))
      plans.push({
        status: 'missing_deposit',
        discrepancyAmount: expectedSum,
        discrepancyReason: `no transfer deposit found for ${dateSales.length} sale(s) expected on ${date}`,
        pairs,
      })
      summary.missing_deposit++
    } else if (remDeposits.length > 0) {
      // ── pass 4: deposits with no sale → left OPEN (out of Stage-1 scope) ───
      summary.deposits_left_open += remDeposits.length
    }
  }

  return { plans, summary }
}

async function loadTransferChannels(
  scope: OwnedScope,
  channelId?: string | null
): Promise<DalResult<PaymentChannel[]>> {
  let q = supabaseAdmin
    .from('payment_channels')
    .select('*')
    .eq('user_id', scope.userId)
    .eq('channel_type', 'transfer')
  if (channelId) q = q.eq('id', channelId)
  const { data, error } = await q
  if (error) return fromSbError(error)
  return dalOk(((data ?? []) as PaymentChannel[]).filter((c) => c.user_id === scope.userId))
}

async function ruleForChannel(channel: PaymentChannel): Promise<ChannelRule> {
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

async function alreadyMatchedIds(
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

async function loadSales(
  scope: OwnedScope,
  channelIds: string[],
  opts: ReconcileOptions
): Promise<DalResult<SalesRecord[]>> {
  if (channelIds.length === 0) return dalOk([])
  let q = supabaseAdmin
    .from('sales_records')
    .select('*')
    .eq('user_id', scope.userId)
    .in('channel_id', channelIds)
    .order('sale_date', { ascending: true })
  if (opts.from) q = q.gte('sale_date', opts.from)
  if (opts.to) q = q.lte('sale_date', opts.to)
  const { data, error } = await q
  if (error) return fromSbError(error)
  return dalOk(((data ?? []) as SalesRecord[]).filter((s) => s.user_id === scope.userId))
}

async function loadDeposits(
  scope: OwnedScope,
  transferChannelIds: Set<string>,
  opts: ReconcileOptions
): Promise<DalResult<DepositRecord[]>> {
  let q = supabaseAdmin
    .from('deposit_records')
    .select('*')
    .eq('user_id', scope.userId)
    .order('deposit_date', { ascending: true })
  if (opts.from) q = q.gte('deposit_date', opts.from)
  if (opts.to) q = q.lte('deposit_date', opts.to)
  const { data, error } = await q
  if (error) return fromSbError(error)
  // Transfer slice: consider deposits hinted at a transfer channel OR with no
  // hint (the parser often can't identify the source bank). Deposits explicitly
  // hinted at a non-transfer channel are left for that channel's engine.
  return dalOk(
    ((data ?? []) as DepositRecord[]).filter(
      (d) => d.user_id === scope.userId && (d.channel_hint == null || transferChannelIds.has(d.channel_hint))
    )
  )
}

async function insertReconciliation(
  scope: OwnedScope,
  plan: PlannedReconciliation
): Promise<DalResult<ReconciliationWithMatches>> {
  const { data, error } = await supabaseAdmin
    .from('reconciliations')
    .insert({
      user_id: scope.userId,
      status: plan.status,
      discrepancy_amount: Math.round(plan.discrepancyAmount * 100) / 100,
      discrepancy_reason: plan.discrepancyReason,
      security_flag: 'none',
      resolved: false,
    })
    .select('*')
    .single()
  if (error) return fromSbError(error)
  const recon = data as Reconciliation
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
    const inserted = await supabaseAdmin.from('reconciliation_matches').insert(rows).select('*')
    if (inserted.error) {
      await supabaseAdmin
        .from('reconciliations')
        .delete()
        .eq('id', recon.id)
        .eq('user_id', scope.userId)
      return fromSbError(inserted.error)
    }
    matches = (inserted.data ?? []) as ReconciliationMatch[]
  }
  return dalOk({ ...recon, matches })
}

export async function reconcileTransfers(
  scope: OwnedScope,
  opts: ReconcileOptions = {}
): Promise<DalResult<{ created: ReconciliationWithMatches[]; summary: ReconcileSummary }>> {
  for (const [k, v] of Object.entries(opts)) {
    if ((k === 'from' || k === 'to') && v != null && !DATE_RE.test(String(v))) {
      return dalErr(400, `${k} must be YYYY-MM-DD`)
    }
  }
  // A supplied channel_id is scoped by loadTransferChannels' user_id filter, so
  // a foreign channel simply yields zero transfer channels (no cross-user read).
  const channelsRes = await loadTransferChannels(scope, opts.channelId ?? undefined)
  if (!channelsRes.ok) return channelsRes
  const channels = channelsRes.data
  const emptySummary: ReconcileSummary = {
    created: 0,
    matched: 0,
    missing_deposit: 0,
    amount_mismatch: 0,
    sales_considered: 0,
    deposits_considered: 0,
    deposits_left_open: 0,
  }
  if (channels.length === 0) return dalOk({ created: [], summary: emptySummary })

  const channelIds = channels.map((c) => c.id)
  const transferChannelIdSet = new Set(channelIds)
  const ruleByChannelId = new Map<string, ChannelRule>()
  for (const channel of channels) {
    ruleByChannelId.set(channel.id, await ruleForChannel(channel))
  }

  const matchedRes = await alreadyMatchedIds(scope)
  if (!matchedRes.ok) return matchedRes

  const salesRes = await loadSales(scope, channelIds, opts)
  if (!salesRes.ok) return salesRes
  const depositsRes = await loadDeposits(scope, transferChannelIdSet, opts)
  if (!depositsRes.ok) return depositsRes

  const { plans, summary: planSummary } = planTransferReconciliations({
    sales: salesRes.data,
    deposits: depositsRes.data,
    ruleByChannelId,
    alreadyMatchedSaleIds: matchedRes.data.sales,
    alreadyMatchedDepositIds: matchedRes.data.deposits,
  })

  const created: ReconciliationWithMatches[] = []
  for (const plan of plans) {
    const res = await insertReconciliation(scope, plan)
    if (!res.ok) return res
    created.push(res.data)
  }

  const summary: ReconcileSummary = { ...planSummary, created: created.length }
  return dalOk({ created, summary })
}
