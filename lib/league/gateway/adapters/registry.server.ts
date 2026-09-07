import 'server-only'

import { createStocksAdapter } from './stocks'
import { createTechAdapter } from './tech'
import {
  createCommodityEnergyAdapter,
  createCryptoAdapter,
  createFxAdapter,
  createGoldMetalAdapter,
  createIndexEtfAdapter,
  createMemecoinAdapter,
  createRealEstateAdapter,
} from './price-series-family'
import { LIVE_PRICE_SERIES_IO } from './price-series-io.server'
import { getResearchPacket } from '../../research'
import { findCatalogInstrument, type PublicCategoryId } from '../../catalog'
import type { CategoryAdapter } from '../types'

/**
 * Live adapter registry. Every public price chip plus ledger-only tech.
 * Lookup misses still mean "no adapter yet" — the orchestrator falls back
 * to the legacy price-series packet path and the gateway refuses with
 * `category_unavailable`. Tech has no public chip yet.
 */
export const stocksAdapter: CategoryAdapter = createStocksAdapter(LIVE_PRICE_SERIES_IO)
export const indexEtfAdapter: CategoryAdapter = createIndexEtfAdapter(LIVE_PRICE_SERIES_IO)
export const goldMetalAdapter: CategoryAdapter = createGoldMetalAdapter(LIVE_PRICE_SERIES_IO)
export const commodityEnergyAdapter: CategoryAdapter = createCommodityEnergyAdapter(LIVE_PRICE_SERIES_IO)
export const fxAdapter: CategoryAdapter = createFxAdapter(LIVE_PRICE_SERIES_IO)
export const cryptoAdapter: CategoryAdapter = createCryptoAdapter(LIVE_PRICE_SERIES_IO)
export const memecoinAdapter: CategoryAdapter = createMemecoinAdapter(LIVE_PRICE_SERIES_IO)
export const realEstateAdapter: CategoryAdapter = createRealEstateAdapter(LIVE_PRICE_SERIES_IO)
export const techAdapter: CategoryAdapter = createTechAdapter({
  getResearchPacket: ({ round, budgetRemainingUsd, tier }) =>
    getResearchPacket({ round, budgetRemainingUsd, tier }),
})

const ADAPTERS: readonly CategoryAdapter[] = [
  stocksAdapter,
  indexEtfAdapter,
  goldMetalAdapter,
  commodityEnergyAdapter,
  fxAdapter,
  cryptoAdapter,
  memecoinAdapter,
  realEstateAdapter,
  techAdapter,
]

export function adapterForCategoryId(id: PublicCategoryId | string): CategoryAdapter | null {
  return ADAPTERS.find((a) => a.category_id === id) ?? null
}

/** Lookup by the round ledger category (`prediction_rounds.category`). */
export function adapterForLedgerCategory(category: string): CategoryAdapter | null {
  return ADAPTERS.find((a) => a.ledger_category === category) ?? null
}

/**
 * Lookup by instrument handle — the grading engine's series-fetch granularity
 * (see `lib/league/gateway/grade-plan.ts`). Instruments outside the public
 * catalog (legacy/admin-created rounds) have no adapter and grade on the
 * legacy price path, exactly as before.
 */
export function adapterForInstrument(instrument: string): CategoryAdapter | null {
  if (instrument.startsWith('TECH:')) return adapterForLedgerCategory('tech')
  const hit = findCatalogInstrument(instrument)
  return hit ? adapterForCategoryId(hit.category.id) : null
}
