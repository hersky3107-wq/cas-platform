/**
 * Reconstruct a ranked-round seed from a public instrument.
 * Used by generate + card locked preview so AIRANK / TECH:OPEN / fixtures
 * do not fall through to catalog-only compose (which returns null → 404).
 */

import { buildCatalogRankedRoundInput, type CatalogRankedRoundInput } from './catalog'
import { isUiHorizon, type UiHorizon } from './horizon'
import { buildAirankRankedRoundInput } from './ai-ranking/resolve'
import { decodeAirankInstrument } from './ai-ranking/instrument'
import { decodeSportsInstrument } from './gateway/adapters/sports-catalog'
import { buildSportsRankedRoundInput } from './gateway/adapters/sports-compose'
import { decodePoliticsInstrument } from './gateway/adapters/politics-catalog'
import { buildPoliticsRankedRoundInput } from './gateway/adapters/politics-compose'
import { decodeEntertainmentInstrument } from './gateway/adapters/entertainment-catalog'
import { buildEntertainmentRankedRoundInput } from './gateway/adapters/entertainment-compose'
import { decodePropertyInstrument } from './gateway/adapters/real-estate-catalog'
import { buildRealEstateRankedRoundInput } from './gateway/adapters/real-estate-compose'
import { buildStockRankedRoundInput, decodeStockInstrument } from './gateway/adapters/stock-catalog'
import { buildOpenTechRankedRoundInput, decodeOpenTechInstrument } from './gateway/adapters/tech-resolve'
import type { ComposedRound } from './gateway/types'

export type PublicRankedRoundSeed = CatalogRankedRoundInput | ComposedRound

export function buildPublicRankedRoundInput(
  instrument: string,
  horizon: UiHorizon,
  now: Date = new Date(),
  locale: 'ko' | 'en' = 'en',
): PublicRankedRoundSeed | null {
  if (decodeAirankInstrument(instrument)) {
    return buildAirankRankedRoundInput(instrument, horizon, now, locale)
  }
  if (decodeOpenTechInstrument(instrument)) {
    return buildOpenTechRankedRoundInput(instrument, now, locale)
  }
  if (decodeSportsInstrument(instrument)) return buildSportsRankedRoundInput(instrument, horizon, now)
  if (decodePoliticsInstrument(instrument)) return buildPoliticsRankedRoundInput(instrument, horizon)
  if (decodeEntertainmentInstrument(instrument)) return buildEntertainmentRankedRoundInput(instrument, horizon)
  if (decodePropertyInstrument(instrument)) return buildRealEstateRankedRoundInput(instrument, horizon)
  if (decodeStockInstrument(instrument)) return buildStockRankedRoundInput(instrument, horizon)
  return buildCatalogRankedRoundInput(instrument, horizon, now)
}

export function publicRoundLocale(raw: string | undefined): 'ko' | 'en' {
  return raw === 'ko' ? 'ko' : 'en'
}

export function isUiHorizonOrNull(value: unknown): value is UiHorizon {
  return typeof value === 'string' && isUiHorizon(value)
}
