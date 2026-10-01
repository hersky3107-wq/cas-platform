import type { StatisticsSnapshot } from './closed-book-packet'

/**
 * Twelve Data /statistics → valuation fields for the closed-book packet.
 * Shape: { statistics: { valuations_metrics: { trailing_pe, price_to_book_mrq,
 * market_capitalization }, financials: { income_statement: { revenue_ttm } } } }.
 */

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function parseTwelveDataStatistics(json: unknown): StatisticsSnapshot {
  const stats = (json as { statistics?: Record<string, any> } | null)?.statistics
  if (!stats || typeof stats !== 'object') return { unavailable: 'Twelve Data /statistics: no statistics object' }
  const val = stats.valuations_metrics ?? {}
  const income = stats.financials?.income_statement ?? {}
  const pe = num(val.trailing_pe)
  const pb = num(val.price_to_book_mrq)
  const marketCap = num(val.market_capitalization)
  const revenueTtm = num(income.revenue_ttm)
  if (pe == null && pb == null && marketCap == null && revenueTtm == null) {
    return { unavailable: 'Twelve Data /statistics: no PE/PB/revenue/market cap fields' }
  }
  return { pe, pb, revenueTtm, marketCap }
}
