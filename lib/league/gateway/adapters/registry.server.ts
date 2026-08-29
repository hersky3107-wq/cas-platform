import 'server-only'

import { createStocksAdapter } from './stocks'
import { LIVE_PRICE_SERIES_IO } from './price-series-io.server'
import type { PublicCategoryId } from '../../catalog'
import type { CategoryAdapter } from '../types'

/**
 * The live adapter registry. ONE adapter exists today (stocks); the other 11
 * chips register here as they are built. Lookup misses are expected and mean
 * "no adapter yet" — the orchestrator falls back to the legacy price-series
 * packet path and the gateway refuses with `category_unavailable`.
 */
export const stocksAdapter: CategoryAdapter = createStocksAdapter(LIVE_PRICE_SERIES_IO)

const ADAPTERS: readonly CategoryAdapter[] = [stocksAdapter]

export function adapterForCategoryId(id: PublicCategoryId | string): CategoryAdapter | null {
  return ADAPTERS.find((a) => a.category_id === id) ?? null
}

/** Lookup by the round ledger category (`prediction_rounds.category`). */
export function adapterForLedgerCategory(category: string): CategoryAdapter | null {
  return ADAPTERS.find((a) => a.ledger_category === category) ?? null
}
