import { findCatalogInstrument } from './catalog'
import { decodeStockInstrument } from './gateway/adapters/stock-catalog'
import { groupForCountry } from './jurisdiction/country-groups'
import type { JurisdictionInput } from './jurisdiction/resolve'

/**
 * Which 주식 surface this account may see.
 *
 * Admission, not a user toggle. Either signal alone is enough:
 * declared Korean nationality OR a Korea IP → Korea lane only.
 * Otherwise → global lane only. The other lane is not a hidden tab.
 *
 * The admin override lives in the hub and is not part of this function.
 */
export type StockLane = 'global' | 'korea'

export function admissionStockLane(input: JurisdictionInput): StockLane {
  const declared = input.declaredCountry?.trim()
  const ip = input.ipCountry?.trim()
  if (declared && groupForCountry(declared) === 'KR') return 'korea'
  if (ip && groupForCountry(ip) === 'KR') return 'korea'
  return 'global'
}

/** US-listed identity: catalog tickers (AAPL/NVDA/TSLA) or a resolved STOCK: row. */
export function isGlobalStockInstrument(instrument: string): boolean {
  if (decodeStockInstrument(instrument)) return true
  return findCatalogInstrument(instrument)?.category.id === 'stocks'
}
