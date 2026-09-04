import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import type { OwnedScope } from '@/lib/reconciliation/scope'
import {
  channelExpectsDeposit,
  expectedDepositDate,
  expectedNet,
  ruleFromRow,
  TRANSFER_RULE,
  type ChannelRule,
} from '@/lib/reconciliation/channel-rules'
import {
  saleKindExemptFromReconcile,
  type DalResult,
  type DepositRecord,
  type PaymentChannel,
  type Reconciliation,
  type ReconciliationMatch,
  type ReconciliationWithMatches,
  type ReconStatus,
  type SalesRecord,
} from '@/lib/reconciliation/types'

/**
 * 대사기 — transfer / app-voucher / card-type reconciliation engine.
 *
 * SCOPE: three deposit-settling channel_types share ONE planner. Transfer
 * (STAGE 1) and app_voucher (STAGE 2) are 0-fee, same-day, deposited at
 * face value. Card-type (STAGE 2c) deducts a percent fee and settles NET.
 * Cash (channel_type='cash') is revenue-only (no bank deposit). paper_voucher
 * will be banked later on a day the system cannot know, so it is also NEVER
 * loaded by a reconciler (`loadChannelsByType` is only called with transfer /
 * app_voucher / card) and is skipped by the planner (expectsDeposit false).
 * There is no reconcileCash() or reconcilePaperVouchers() — the latter would
 * false-flag missing_deposit against the sale date.
 *
 * OWNERSHIP: takes OwnedScope from withOwnedScope() and filters every query by
 * user_id = scope.userId. supabaseAdmin bypasses RLS; this is the auth gate.
 *
 * ALGORITHM (per expected-settlement date) — shared via
 * planTransferReconciliations():
 *   1. exact 1:1 NET-amount matches → one `matched` reconciliation each,
 *   2. remainder sales+deposits → one batch reconciliation:
 *        net-sums equal (within tolerance) → matched, else amount_mismatch (N:M),
 *   3. remainder sales, no deposit → missing_deposit,
 *   4. remainder deposits, no sale → left OPEN for transfer/app_voucher
 *        (byte-identical to Stage 1/2); card-type flags unmatched_deposit.
 *
 * IDEMPOTENT: sales/deposits already referenced by a reconciliation_matches row
 * are excluded, so re-running does not double-create.
 *
 * This module is split into:
 *   - planTransferReconciliations(): PURE decision logic. Takes plain arrays +
 *     a rule map + already-matched id sets, returns what *would* be created.
 *     No supabase, no I/O, no channel-type awareness at all (a channel is
 *     just a string key into the rule map).
 *   - reconcileByChannelType(): shared orchestrator.
 *   - reconcileTransfers() / reconcileAppVouchers() / reconcileCards(): thin
 *     wrappers. Transfer/app_voucher keep includeUnhinted / unmatched-deposit
 *     flags as before so their verified behavior stays byte-identical.
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
  unmatched_deposit: number
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
  /**
   * When true, leftover deposits (no open sale on that date) become
   * unmatched_deposit plans. Default false: leftover deposits stay OPEN
   * (Stage-1/2 transfer + app_voucher behavior, byte-identical).
   */
  flagUnmatchedDeposits?: boolean
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
  const flagUnmatchedDeposits = input.flagUnmatchedDeposits === true

  const ruleFor = (sale: PlannerSaleInput): ChannelRule =>
    (sale.channel_id && ruleByChannelId.get(sale.channel_id)) || TRANSFER_RULE

  // Cash / paper_voucher (expectsDeposit: false) are never matched and never
  // flagged missing_deposit. Orchestrators also omit those channels; this
  // filter is defense-in-depth if such a sale is passed in.
  const sales = input.sales.filter(
    (s) => !matchedSaleIds.has(s.id) && channelExpectsDeposit(ruleFor(s))
  )
  const deposits = input.deposits.filter((d) => !matchedDepositIds.has(d.id))

  const plans: PlannedReconciliation[] = []
  const summary: PlanSummary = {
    matched: 0,
    missing_deposit: 0,
    amount_mismatch: 0,
    unmatched_deposit: 0,
    sales_considered: sales.length,
    deposits_considered: deposits.length,
    deposits_left_open: 0,
  }

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
      // ── pass 4: deposits with no sale ─────────────────────────────────────
      // Transfer / app_voucher (default): leave OPEN — byte-identical to Stage 1/2.
      // Card-type (flagUnmatchedDeposits): numeric unmatched_deposit flag only;
      // no AI explanation in this step.
      if (flagUnmatchedDeposits) {
        const actualSum = remDeposits.reduce((sum, d) => sum + d.actual_amount, 0)
        plans.push({
          status: 'unmatched_deposit',
          discrepancyAmount: Math.round(actualSum * 100) / 100,
          discrepancyReason: `no sale found for ${remDeposits.length} deposit(s) on ${date}`,
          pairs: remDeposits.map((d) => ({ sale_id: null, deposit_id: d.id })),
        })
        summary.unmatched_deposit++
      } else {
        summary.deposits_left_open += remDeposits.length
      }
    }
  }

  return { plans, summary }
}

async function loadChannelsByType(
  scope: OwnedScope,
  channelType: string,
  channelId?: string | null
): Promise<DalResult<PaymentChannel[]>> {
  let q = supabaseAdmin
    .from('payment_channels')
    .select('*')
    .eq('user_id', scope.userId)
    .eq('channel_type', channelType)
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
  return dalOk(
    ((data ?? []) as SalesRecord[]).filter(
      (s) => s.user_id === scope.userId && !saleKindExemptFromReconcile(s.sale_kind)
    )
  )
}

/**
 * Deposits eligible for ONE channel_type's pass: explicitly hinted at one of
 * `channelIds`, or — only when `includeUnhinted` — carrying no hint at all.
 *
 * Transfer keeps `includeUnhinted = true` (its Stage-1 behavior, unchanged):
 * the parser often can't identify the source bank, so an un-hinted deposit
 * defaults to the transfer catch-all.
 *
 * App-voucher uses `includeUnhinted = false`: a voucher deposit is only ever
 * produced by VOUCHER_PARSE_SPEC, which extracts the voucher name and hints
 * the channel at parse time (see app/api/reconciliation/parse-voucher).
 * Card-type also uses `includeUnhinted = false`: card deposits are entered
 * with an explicit channel_hint (manual for now; unified parse later).
 * Leaving un-hinted deposits out of these passes means the engines never
 * compete over the same ambiguous row.
 */
async function loadDepositsForChannels(
  scope: OwnedScope,
  channelIds: Set<string>,
  opts: ReconcileOptions,
  includeUnhinted: boolean
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
  return dalOk(
    ((data ?? []) as DepositRecord[]).filter(
      (d) =>
        d.user_id === scope.userId &&
        (d.channel_hint == null ? includeUnhinted : channelIds.has(d.channel_hint))
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

/**
 * Shared orchestrator for any channel_type whose settlement behaves like a
 * transfer (0 fee, direct deposit): loads that type's channels/rules/open
 * rows, then delegates every matching decision to the pure planner. Adding a
 * third such channel means one more thin wrapper below, not a new engine.
 */
async function reconcileByChannelType(
  scope: OwnedScope,
  opts: ReconcileOptions,
  channelType: string,
  includeUnhintedDeposits: boolean,
  flagUnmatchedDeposits = false
): Promise<DalResult<{ created: ReconciliationWithMatches[]; summary: ReconcileSummary }>> {
  for (const [k, v] of Object.entries(opts)) {
    if ((k === 'from' || k === 'to') && v != null && !DATE_RE.test(String(v))) {
      return dalErr(400, `${k} must be YYYY-MM-DD`)
    }
  }
  // A supplied channel_id is scoped by loadChannelsByType's user_id filter, so
  // a foreign channel simply yields zero channels of this type (no cross-user read).
  const channelsRes = await loadChannelsByType(scope, channelType, opts.channelId ?? undefined)
  if (!channelsRes.ok) return channelsRes
  const channels = channelsRes.data
  const emptySummary: ReconcileSummary = {
    created: 0,
    matched: 0,
    missing_deposit: 0,
    amount_mismatch: 0,
    unmatched_deposit: 0,
    sales_considered: 0,
    deposits_considered: 0,
    deposits_left_open: 0,
  }
  if (channels.length === 0) return dalOk({ created: [], summary: emptySummary })

  const channelIds = channels.map((c) => c.id)
  const channelIdSet = new Set(channelIds)
  const ruleByChannelId = new Map<string, ChannelRule>()
  for (const channel of channels) {
    ruleByChannelId.set(channel.id, await ruleForChannel(channel))
  }

  const matchedRes = await alreadyMatchedIds(scope)
  if (!matchedRes.ok) return matchedRes

  const salesRes = await loadSales(scope, channelIds, opts)
  if (!salesRes.ok) return salesRes
  const depositsRes = await loadDepositsForChannels(scope, channelIdSet, opts, includeUnhintedDeposits)
  if (!depositsRes.ok) return depositsRes

  const { plans, summary: planSummary } = planTransferReconciliations({
    sales: salesRes.data,
    deposits: depositsRes.data,
    ruleByChannelId,
    alreadyMatchedSaleIds: matchedRes.data.sales,
    alreadyMatchedDepositIds: matchedRes.data.deposits,
    flagUnmatchedDeposits,
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

/** STAGE 1: bank-transfer channels. Behavior unchanged from before Stage 2. */
export async function reconcileTransfers(
  scope: OwnedScope,
  opts: ReconcileOptions = {}
): Promise<DalResult<{ created: ReconciliationWithMatches[]; summary: ReconcileSummary }>> {
  return reconcileByChannelType(scope, opts, 'transfer', true)
}

/**
 * STAGE 2: app/barcode local-voucher channels (탐나는전 앱, 온누리 앱). Same
 * matcher as reconcileTransfers — zero new decision logic, see the module
 * doc comment.
 */
export async function reconcileAppVouchers(
  scope: OwnedScope,
  opts: ReconcileOptions = {}
): Promise<DalResult<{ created: ReconciliationWithMatches[]; summary: ReconcileSummary }>> {
  return reconcileByChannelType(scope, opts, 'app_voucher', false)
}

/**
 * STAGE 2c: card-type family (channel_type='card'). Same planner as
 * reconcileTransfers — fee + settlement window come from CARD_RULE / a
 * stored reconciliation_rules row. Unhinted deposits are excluded (set
 * channel_hint on a manually entered deposit). Leftover deposits are
 * flagged unmatched_deposit (numeric only; no AI explanation yet).
 */
export async function reconcileCards(
  scope: OwnedScope,
  opts: ReconcileOptions = {}
): Promise<DalResult<{ created: ReconciliationWithMatches[]; summary: ReconcileSummary }>> {
  return reconcileByChannelType(scope, opts, 'card', false, true)
}

// Cash and paper_voucher have no reconciler. They are stored as revenue and
// skipped by every deposit matcher — see CASH_RULE / PAPER_VOUCHER_RULE
// expectsDeposit. loadChannelsByType is only invoked for 'transfer',
// 'app_voucher', and 'card'.
