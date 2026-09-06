/**
 * 정산대사기 — pure per-issuer / per-method WINDOW planner (Step-2 reqs A–C).
 *
 * Replaces the retired single-expected-date planner. Differences that matter:
 *
 *   WINDOW, not a date. A deposit matches a sale when deposit_date ∈
 *   [sale_date, sale_date + settlement_days + settlement_window_days], read
 *   per issuer (card) or per channel rule (voucher/delivery/…). This is what
 *   lets late-August sales match early-September deposits: months are
 *   irrelevant, only the window counts.
 *
 *   NET of refunds. gross_amount is signed; a refund (negative) nets against
 *   positive sales of the SAME group inside the same window before any
 *   comparison. A batch deposit is Σ netWon(gross_i) over the batch.
 *
 *   FRACTION fees only. Every group rule carries a branded FractionRate
 *   (fees.ts); percent-unit rule rows are converted by the orchestrator with
 *   an explicit toFraction() — a bare number cannot reach this module.
 *
 *   DETERMINISTIC ONLY FLAGS WHAT IS CERTAIN.
 *     matched          — exact 1:1 / one-day batch / window batch, within
 *                        rounding tolerance. Residual (≤ tolerance) recorded.
 *     missing_deposit  — only after the sale's window has fully EXPIRED
 *                        (no legitimate deposit date remains) — never while
 *                        money may still be on its way.
 *     unmatched_deposit— only for an AGED deposit with zero candidate sales
 *                        in its window (nothing the AI could even reason on).
 *   Everything else is LEFT OPEN for the AI proposal layer
 *   (match-infer.ts): near-miss amounts, multi-day ambiguity, partial
 *   coverage. Deterministic code never guesses — that is the whole split.
 *
 *   amount_mismatch is NOT produced here anymore: it now arises only when
 *   the OWNER approves an AI proposal whose residual exceeds tolerance
 *   (proposals-db.ts), keeping the human in the loop for every non-exact
 *   claim about money.
 *
 * IDEMPOTENT: rows in alreadyMatched sets are excluded up front, so re-runs
 * never double-plan (same contract as the retired planner, verified in
 * scripts/verify-reconciliation-matcher.ts).
 *
 * Pure: no supabase, no I/O, no Date.now() — `today` is an input.
 */

import { matchToleranceWon, netWon, type FractionRate } from '@/lib/reconciliation/fees'

export type GroupRule = {
  /** Orchestrator-assigned key: `issuer:<uuid>` or `method:<code>:<channel_id>`. */
  groupKey: string
  methodCode: string
  issuerId: string | null
  /** Display name for reason strings (카드사명 or channel name). */
  label: string
  fee: FractionRate
  settlementDays: number
  windowDays: number
  /**
   * Extra won slack from the channel rule (0 for issuers — their tolerance is
   * matchToleranceWon rounding slack only). Effective tolerance is
   * max(matchToleranceWon(n), toleranceWon).
   */
  toleranceWon: number
}

export type WindowSaleInput = {
  id: string
  sale_date: string
  /** Signed won. Negative = refund, nets inside its group window. */
  gross_amount: number
  groupKey: string
}

export type WindowDepositInput = {
  id: string
  deposit_date: string
  actual_amount: number
  groupKey: string
}

export type WindowMatchKind =
  | 'exact_1to1'
  | 'day_batch'
  | 'window_batch'
  | 'multi_deposit_batch'
  | 'missing_deposit'
  | 'unmatched_deposit'

export type WindowPlan = {
  status: 'matched' | 'missing_deposit' | 'unmatched_deposit'
  matchKind: WindowMatchKind
  groupKey: string
  methodCode: string
  issuerId: string | null
  /** Signed: expected net − actual. For matched plans this is the absorbed rounding residual. */
  discrepancyAmount: number
  discrepancyReason: string
  pairs: { sale_id: string | null; deposit_id: string | null }[]
}

export type WindowPlanSummary = {
  matched: number
  missing_deposit: number
  unmatched_deposit: number
  /** Deposits deterministic matching could not resolve — the AI inference queue. */
  deposits_left_open_for_ai: number
  /** Unmatched sales whose window is still open (money may still arrive). */
  sales_left_open: number
  sales_considered: number
  deposits_considered: number
}

export type PlanWindowInput = {
  /** YYYY-MM-DD (KST). Expiry decisions compare against this, never Date.now(). */
  today: string
  rulesByGroup: ReadonlyMap<string, GroupRule>
  sales: readonly WindowSaleInput[]
  deposits: readonly WindowDepositInput[]
  alreadyMatchedSaleIds?: ReadonlySet<string>
  alreadyMatchedDepositIds?: ReadonlySet<string>
  /** Days after deposit_date before a candidate-free deposit is flagged unmatched_deposit. */
  unmatchedDepositAgeDays?: number
}

const DEFAULT_UNMATCHED_DEPOSIT_AGE_DAYS = 14

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function windowEnd(saleDate: string, rule: GroupRule): string {
  return addDaysIso(saleDate, rule.settlementDays + rule.windowDays)
}

function saleInWindowOfDeposit(sale: WindowSaleInput, depositDate: string, rule: GroupRule): boolean {
  return depositDate >= sale.sale_date && depositDate <= windowEnd(sale.sale_date, rule)
}

function dayGap(a: string, b: string): number {
  const ms = Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime())
  return Math.round(ms / 86_400_000)
}

function won(n: number): string {
  return `₩${Math.round(n).toLocaleString('ko-KR')}`
}

type GroupState = {
  rule: GroupRule
  sales: WindowSaleInput[]
  deposits: WindowDepositInput[]
}

export function planWindowReconciliations(input: PlanWindowInput): {
  plans: WindowPlan[]
  summary: WindowPlanSummary
} {
  const matchedSales = input.alreadyMatchedSaleIds ?? new Set<string>()
  const matchedDeposits = input.alreadyMatchedDepositIds ?? new Set<string>()
  const ageDays = input.unmatchedDepositAgeDays ?? DEFAULT_UNMATCHED_DEPOSIT_AGE_DAYS

  const groups = new Map<string, GroupState>()
  for (const rule of input.rulesByGroup.values()) {
    groups.set(rule.groupKey, { rule, sales: [], deposits: [] })
  }

  const summary: WindowPlanSummary = {
    matched: 0,
    missing_deposit: 0,
    unmatched_deposit: 0,
    deposits_left_open_for_ai: 0,
    sales_left_open: 0,
    sales_considered: 0,
    deposits_considered: 0,
  }

  for (const sale of input.sales) {
    if (matchedSales.has(sale.id)) continue
    const group = groups.get(sale.groupKey)
    if (!group) continue // groupless rows are not this planner's business
    group.sales.push(sale)
    summary.sales_considered++
  }
  for (const deposit of input.deposits) {
    if (matchedDeposits.has(deposit.id)) continue
    const group = groups.get(deposit.groupKey)
    if (!group) continue
    group.deposits.push(deposit)
    summary.deposits_considered++
  }

  const plans: WindowPlan[] = []

  for (const group of groups.values()) {
    const { rule } = group
    let sales = [...group.sales].sort(
      (a, b) => a.sale_date.localeCompare(b.sale_date) || a.id.localeCompare(b.id)
    )
    let deposits = [...group.deposits].sort(
      (a, b) => a.deposit_date.localeCompare(b.deposit_date) || a.id.localeCompare(b.id)
    )

    const netOf = (s: WindowSaleInput): number => netWon(s.gross_amount, rule.fee)
    const tolFor = (n: number): number => Math.max(matchToleranceWon(n), rule.toleranceWon)
    const feePct = (rule.fee.value * 100).toFixed(rule.fee.value * 100 % 1 === 0 ? 0 : 2)

    const consume = (saleIds: Set<string>, depositIds: Set<string>): void => {
      sales = sales.filter((s) => !saleIds.has(s.id))
      deposits = deposits.filter((d) => !depositIds.has(d.id))
    }

    const emitMatch = (
      kind: WindowMatchKind,
      matchedSalesList: WindowSaleInput[],
      matchedDepositsList: WindowDepositInput[],
      reason: string,
      residual: number
    ): void => {
      const pairs: WindowPlan['pairs'] = []
      for (const s of matchedSalesList) {
        for (const d of matchedDepositsList) pairs.push({ sale_id: s.id, deposit_id: d.id })
      }
      plans.push({
        status: 'matched',
        matchKind: kind,
        groupKey: rule.groupKey,
        methodCode: rule.methodCode,
        issuerId: rule.issuerId,
        discrepancyAmount: residual,
        discrepancyReason: reason,
        pairs,
      })
      summary.matched++
      consume(new Set(matchedSalesList.map((s) => s.id)), new Set(matchedDepositsList.map((d) => d.id)))
    }

    // ── pass 1: exact 1:1 (positive sale ↔ deposit inside the window) ───────
    // Skipped for a deposit whose window contains any refund: the deposit then
    // reflects a NETTED total and a naive 1:1 link would misattribute it —
    // the day/window batch passes handle netting.
    for (const deposit of [...deposits]) {
      const inWindow = sales.filter((s) => saleInWindowOfDeposit(s, deposit.deposit_date, rule))
      if (inWindow.some((s) => s.gross_amount < 0)) continue
      const tol = tolFor(1)
      const candidates = inWindow
        .filter((s) => s.gross_amount > 0)
        .sort((a, b) => {
          const expA = addDaysIso(a.sale_date, rule.settlementDays)
          const expB = addDaysIso(b.sale_date, rule.settlementDays)
          return (
            dayGap(deposit.deposit_date, expA) - dayGap(deposit.deposit_date, expB) ||
            a.sale_date.localeCompare(b.sale_date) ||
            a.id.localeCompare(b.id)
          )
        })
      const hit = candidates.find((s) => Math.abs(netOf(s) - deposit.actual_amount) <= tol)
      if (!hit) continue
      const residual = netOf(hit) - deposit.actual_amount
      emitMatch(
        'exact_1to1',
        [hit],
        [deposit],
        `${rule.label} ${hit.sale_date} 매출 ${won(hit.gross_amount)} → 수수료 ${feePct}% 반영 ${won(netOf(hit))} ≒ ${deposit.deposit_date} 입금 ${won(deposit.actual_amount)}${residual !== 0 ? ` (반올림 차이 ${won(Math.abs(residual))} 흡수)` : ''}`,
        residual
      )
    }

    // ── pass 2: one-day batch — a day's slips (minus that day's refunds) ────
    for (const deposit of [...deposits]) {
      const inWindow = sales.filter((s) => saleInWindowOfDeposit(s, deposit.deposit_date, rule))
      if (inWindow.length === 0) continue
      const dates = [...new Set(inWindow.map((s) => s.sale_date))].sort((a, b) => {
        const expA = addDaysIso(a, rule.settlementDays)
        const expB = addDaysIso(b, rule.settlementDays)
        return (
          dayGap(deposit.deposit_date, expA) - dayGap(deposit.deposit_date, expB) || a.localeCompare(b)
        )
      })
      for (const date of dates) {
        const daySales = inWindow.filter((s) => s.sale_date === date)
        const sum = daySales.reduce((acc, s) => acc + netOf(s), 0)
        if (sum <= 0) continue
        if (Math.abs(sum - deposit.actual_amount) > tolFor(daySales.length)) continue
        const refunds = daySales.filter((s) => s.gross_amount < 0).length
        const residual = sum - deposit.actual_amount
        emitMatch(
          'day_batch',
          daySales,
          [deposit],
          `${rule.label} ${date} 매출 ${daySales.length}건${refunds > 0 ? ` (환불 ${refunds}건 상계)` : ''} 합계 ${won(sum)} ≒ ${deposit.deposit_date} 입금 ${won(deposit.actual_amount)} (수수료 ${feePct}%)`,
          residual
        )
        break
      }
    }

    // ── pass 3: whole-window batch — multi-day batch settles as one deposit ─
    for (const deposit of [...deposits]) {
      const inWindow = sales.filter((s) => saleInWindowOfDeposit(s, deposit.deposit_date, rule))
      if (inWindow.length === 0) continue
      const sum = inWindow.reduce((acc, s) => acc + netOf(s), 0)
      if (sum <= 0) continue
      if (Math.abs(sum - deposit.actual_amount) > tolFor(inWindow.length)) continue
      const refunds = inWindow.filter((s) => s.gross_amount < 0).length
      const dates = [...new Set(inWindow.map((s) => s.sale_date))].sort()
      const residual = sum - deposit.actual_amount
      emitMatch(
        'window_batch',
        inWindow,
        [deposit],
        `${rule.label} ${dates[0]}~${dates[dates.length - 1]} 매출 ${inWindow.length}건${refunds > 0 ? ` (환불 ${refunds}건 상계)` : ''} 합계 ${won(sum)} ≒ ${deposit.deposit_date} 입금 ${won(deposit.actual_amount)}`,
        residual
      )
    }

    // ── pass 4: several deposits on one day covering one period ─────────────
    {
      const byDate = new Map<string, WindowDepositInput[]>()
      for (const d of deposits) {
        const list = byDate.get(d.deposit_date) ?? []
        list.push(d)
        byDate.set(d.deposit_date, list)
      }
      for (const [date, dateDeposits] of byDate) {
        if (dateDeposits.length < 2) continue
        const inWindow = sales.filter((s) => saleInWindowOfDeposit(s, date, rule))
        if (inWindow.length === 0) continue
        const saleSum = inWindow.reduce((acc, s) => acc + netOf(s), 0)
        const depositSum = dateDeposits.reduce((acc, d) => acc + d.actual_amount, 0)
        if (saleSum <= 0) continue
        if (Math.abs(saleSum - depositSum) > tolFor(inWindow.length)) continue
        const residual = saleSum - depositSum
        emitMatch(
          'multi_deposit_batch',
          inWindow,
          dateDeposits,
          `${rule.label} 매출 ${inWindow.length}건 합계 ${won(saleSum)} ≒ ${date} 입금 ${dateDeposits.length}건 합계 ${won(depositSum)}`,
          residual
        )
      }
    }

    // ── pass 5: window EXPIRED, still unmatched → missing_deposit ───────────
    // Grouped per sale_date so the owner sees "이 날 카드 매출이 안 들어왔다".
    // A day whose net is <= 0 (refund-heavy) expects no deposit — left open.
    {
      const expired = sales.filter((s) => windowEnd(s.sale_date, rule) < input.today)
      const byDate = new Map<string, WindowSaleInput[]>()
      for (const s of expired) {
        const list = byDate.get(s.sale_date) ?? []
        list.push(s)
        byDate.set(s.sale_date, list)
      }
      for (const [date, daySales] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const sum = daySales.reduce((acc, s) => acc + netOf(s), 0)
        if (sum <= 0) continue
        plans.push({
          status: 'missing_deposit',
          matchKind: 'missing_deposit',
          groupKey: rule.groupKey,
          methodCode: rule.methodCode,
          issuerId: rule.issuerId,
          discrepancyAmount: sum,
          discrepancyReason: `${rule.label} ${date} 매출 ${daySales.length}건 예상 입금 ${won(sum)} — 정산 기한(${addDaysIso(date, rule.settlementDays + rule.windowDays)})이 지나도록 입금 없음`,
          pairs: daySales.map((s) => ({ sale_id: s.id, deposit_id: null })),
        })
        summary.missing_deposit++
        consume(new Set(daySales.map((s) => s.id)), new Set())
      }
    }

    // ── pass 6: aged deposit with ZERO candidate sales → unmatched_deposit ──
    // A younger deposit, or one that still has open sales in its window,
    // stays OPEN — that is the AI inference queue, not a verdict.
    for (const deposit of [...deposits]) {
      const aged = addDaysIso(deposit.deposit_date, ageDays) < input.today
      const hasCandidates = sales.some((s) => saleInWindowOfDeposit(s, deposit.deposit_date, rule))
      if (!aged || hasCandidates) continue
      plans.push({
        status: 'unmatched_deposit',
        matchKind: 'unmatched_deposit',
        groupKey: rule.groupKey,
        methodCode: rule.methodCode,
        issuerId: rule.issuerId,
        discrepancyAmount: -deposit.actual_amount,
        discrepancyReason: `${rule.label} ${deposit.deposit_date} 입금 ${won(deposit.actual_amount)} — ${ageDays}일이 지나도록 해당 기간에 대응하는 매출 기록이 없음`,
        pairs: [{ sale_id: null, deposit_id: deposit.id }],
      })
      summary.unmatched_deposit++
      consume(new Set(), new Set([deposit.id]))
    }

    summary.deposits_left_open_for_ai += deposits.length
    summary.sales_left_open += sales.length
  }

  return { plans, summary }
}
