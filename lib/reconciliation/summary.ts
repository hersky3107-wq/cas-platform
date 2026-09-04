import {
  MonthlyReconciliationSummary,
  SaleKind,
  SALE_KINDS,
} from './types'

export const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/

/**
 * Returns the inclusive start ('YYYY-MM-01') and end ('YYYY-MM-LD') date
 * strings for a given 'YYYY-MM' month string.
 */
export function getMonthDateRange(
  monthStr: string
): { from: string; to: string } | null {
  if (!MONTH_RE.test(monthStr)) {
    return null
  }
  const [y, m] = monthStr.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    from: `${y}-${pad(m)}-01`,
    to: `${y}-${pad(m)}-${pad(lastDay)}`,
  }
}

export type SummarySaleInput = {
  id: string
  sale_date: string
  gross_amount: number
  discount_amount: number | null
  sale_kind: SaleKind | string
}

export type SummaryDepositInput = {
  id: string
  deposit_date: string
  actual_amount: number
  memo?: string | null
}

export type SummaryReconciliationInput = {
  id: string
  status: string
  discrepancy_amount?: number | null
}

export type SummaryMatchInput = {
  reconciliation_id: string
  sales_record_id: string | null
  deposit_record_id: string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Pure computation of monthly totals and status counts for the /reconciliation view.
 *
 * CRITICAL invariant:
 * Paper voucher sales are counted in total_sales on their sale date, but the bank
 * deposit for those vouchers arrives whenever the owner banks them — possibly weeks
 * later, in a different month. We never add paper voucher sales and later deposits
 * together, nor do we subtract deposits from total sales as a shortfall.
 */
export function computeMonthlySummaryData(params: {
  month: string
  from: string
  to: string
  sales: SummarySaleInput[]
  deposits: SummaryDepositInput[]
  reconciliations: SummaryReconciliationInput[]
  matches: SummaryMatchInput[]
}): MonthlyReconciliationSummary {
  const { month, from, to, sales, deposits, reconciliations, matches } = params

  const saleIdsInMonth = new Set<string>()
  for (const s of sales) {
    if (s.sale_date >= from && s.sale_date <= to) {
      saleIdsInMonth.add(s.id)
    }
  }

  const depositIdsInMonth = new Set<string>()
  for (const d of deposits) {
    if (d.deposit_date >= from && d.deposit_date <= to) {
      depositIdsInMonth.add(d.id)
    }
  }

  const reconStatusMap = new Map<string, string>()
  for (const r of reconciliations) {
    reconStatusMap.set(r.id, r.status)
  }

  const matchedDepositIds = new Set<string>()
  const reconsInMonth = new Set<string>()

  for (const m of matches) {
    const status = reconStatusMap.get(m.reconciliation_id)
    // Deposit in month
    if (m.deposit_record_id && depositIdsInMonth.has(m.deposit_record_id)) {
      if (m.sales_record_id || status === 'matched' || status === 'amount_mismatch') {
        matchedDepositIds.add(m.deposit_record_id)
      }
      if (status) {
        reconsInMonth.add(m.reconciliation_id)
      }
    }
    // Sale in month
    if (m.sales_record_id && saleIdsInMonth.has(m.sales_record_id)) {
      if (status) {
        reconsInMonth.add(m.reconciliation_id)
      }
    }
  }

  let countMatched = 0
  let countMissingDeposit = 0
  let countAmountMismatch = 0

  for (const reconId of reconsInMonth) {
    const status = reconStatusMap.get(reconId)
    if (status === 'matched') countMatched++
    else if (status === 'missing_deposit') countMissingDeposit++
    else if (status === 'amount_mismatch') countAmountMismatch++
  }

  let totalSales = 0
  let totalDiscount = 0
  const salesByKind: Record<SaleKind, { amount: number; count: number }> = {
    card: { amount: 0, count: 0 },
    app_voucher: { amount: 0, count: 0 },
    paper_voucher: { amount: 0, count: 0 },
    cash: { amount: 0, count: 0 },
    manual_total: { amount: 0, count: 0 },
  }

  for (const s of sales) {
    if (s.sale_date < from || s.sale_date > to) continue
    const gross = Number(s.gross_amount) || 0
    totalSales += gross
    if (s.discount_amount != null) {
      totalDiscount += Number(s.discount_amount) || 0
    }
    const rawKind = s.sale_kind as SaleKind
    const kind: SaleKind = SALE_KINDS.includes(rawKind) ? rawKind : 'manual_total'
    salesByKind[kind].amount += gross
    salesByKind[kind].count += 1
  }

  let totalDepositsAmount = 0
  let totalDepositsCount = 0
  let matchedDepositsAmount = 0
  let matchedDepositsCount = 0
  let unmatchedDepositsAmount = 0
  let unmatchedDepositsCount = 0

  for (const d of deposits) {
    if (d.deposit_date < from || d.deposit_date > to) continue
    const amt = Number(d.actual_amount) || 0
    totalDepositsAmount += amt
    totalDepositsCount++
    if (matchedDepositIds.has(d.id)) {
      matchedDepositsAmount += amt
      matchedDepositsCount++
    } else {
      unmatchedDepositsAmount += amt
      unmatchedDepositsCount++
    }
  }

  return {
    month,
    from,
    to,
    total_sales: round2(totalSales),
    total_discount: round2(totalDiscount),
    sales_by_kind: {
      card: {
        amount: round2(salesByKind.card.amount),
        count: salesByKind.card.count,
      },
      app_voucher: {
        amount: round2(salesByKind.app_voucher.amount),
        count: salesByKind.app_voucher.count,
      },
      paper_voucher: {
        amount: round2(salesByKind.paper_voucher.amount),
        count: salesByKind.paper_voucher.count,
      },
      cash: {
        amount: round2(salesByKind.cash.amount),
        count: salesByKind.cash.count,
      },
      manual_total: {
        amount: round2(salesByKind.manual_total.amount),
        count: salesByKind.manual_total.count,
      },
    },
    deposits: {
      total_amount: round2(totalDepositsAmount),
      total_count: totalDepositsCount,
      matched_amount: round2(matchedDepositsAmount),
      matched_count: matchedDepositsCount,
      unmatched_amount: round2(unmatchedDepositsAmount),
      unmatched_count: unmatchedDepositsCount,
    },
    counts: {
      matched: countMatched,
      missing_deposit: countMissingDeposit,
      amount_mismatch: countAmountMismatch,
      paper_voucher_pending: salesByKind.paper_voucher.count,
    },
    paper_voucher_pending_amount: round2(salesByKind.paper_voucher.amount),
  }
}
