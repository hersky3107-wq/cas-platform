/**
 * STOCK:{exchange}:{symbol}
 *
 * Resolved US listing identity persisted on the round the same way
 * MATCH: / ELECTION: / SHOW: / PROPERTY: persist theirs. Catalog flagships
 * (AAPL, NVDA, TSLA) stay plain tickers so existing rounds keep grading.
 * expected_name is written into resolution_rule — the instrument id cannot
 * carry a display name that itself contains colons.
 */

import { cacheBucketFor, computeResolvesAt, tradingApproximationNote, type UiHorizon } from '../../horizon'
import type { CatalogRankedRoundInput } from '../../catalog'

export type StockParts = {
  exchange: string
  symbol: string
}

const SYMBOL_RE = /^[A-Z.]{1,6}$/

/** NYSE / NASDAQ and the ADR venues Twelve Data labels on those tapes. */
const US_EXCHANGES = new Set([
  'NASDAQ',
  'NASDAQGS',
  'NASDAQGM',
  'NYSE',
  'NYSE ARCA',
  'NYSE AMERICAN',
  'AMEX',
  'BATS',
])

export function isUsListingExchange(exchange: string): boolean {
  return US_EXCHANGES.has(exchange.trim().toUpperCase())
}

export function encodeStockInstrument(args: { exchange: string; symbol: string }): string | null {
  const exchange = args.exchange.trim().toUpperCase()
  const symbol = args.symbol.trim().toUpperCase()
  if (!isUsListingExchange(exchange) || !SYMBOL_RE.test(symbol)) return null
  return `STOCK:${exchange}:${symbol}`
}

export function decodeStockInstrument(instrument: string | null | undefined): StockParts | null {
  if (!instrument) return null
  const parts = instrument.split(':')
  if (parts.length !== 3 || parts[0] !== 'STOCK') return null
  const exchange = (parts[1] ?? '').trim().toUpperCase()
  const symbol = (parts[2] ?? '').trim().toUpperCase()
  if (!isUsListingExchange(exchange) || !SYMBOL_RE.test(symbol)) return null
  return { exchange, symbol }
}

/** Plain ticker the quote/series/analyst call will use once Ultra is on. */
export function stockQuoteSymbol(instrument: string): string {
  return decodeStockInstrument(instrument)?.symbol ?? instrument.trim()
}

export function stockChipLabel(instrument: string): string | null {
  const parts = decodeStockInstrument(instrument)
  if (!parts) return null
  return `${parts.symbol} · ${parts.exchange}`
}

/**
 * Korean listings typed into the global lane. They are not opened as US
 * tickers (symbol_search on "Samsung" returns 005930.KRX).
 */
export function mentionsKoreaListing(raw: string): boolean {
  const compact = raw.replace(/\s+/g, '')
  if (compact.includes('삼성전자') || compact.includes('삼전') || compact.includes('005930')) return true
  if (/\bsamsung\b/i.test(raw)) return true
  if (/^\d{6}(\.(ks|kq))?$/i.test(raw.trim())) return true
  return false
}

export function buildStockRankedRoundInput(
  instrument: string,
  uiHorizon: UiHorizon,
  now: Date = new Date(),
  expectedName?: string | null,
): CatalogRankedRoundInput | null {
  const parts = decodeStockInstrument(instrument)
  if (!parts) return null
  const bucket = cacheBucketFor(uiHorizon, now)
  const resolvesAt = computeResolvesAt('stock', uiHorizon, now.toISOString(), parts.symbol)
  const resolveDate = resolvesAt.slice(0, 10)
  const note = tradingApproximationNote('stock', uiHorizon, parts.symbol)
  const name = (expectedName ?? parts.symbol).replace(/[\r\n]/g, ' ').trim().slice(0, 80) || parts.symbol
  const proposition_text = `Will ${parts.symbol} close higher by ${resolveDate} than its last close?${
    note ? ` (${resolveDate} ${note}.)` : ''
  }`
  return {
    proposition_text,
    category: 'stock',
    instrument,
    horizon: uiHorizon,
    resolution_rule: `${parts.exchange} regular-session close. Identity: ${name}.`,
    resolves_at: resolvesAt,
    item_type: 'ranked',
    cache_key: `daily|${instrument}|${uiHorizon}|${bucket}`,
  }
}
