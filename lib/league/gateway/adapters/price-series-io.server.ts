import 'server-only'

import { fetchDataPacket } from '../../market-data'
import { fetchCryptoContext, fetchMarketConsensus } from '../../market-context'
import { getResearchPacket } from '../../research'
import { fetchRelatedInstruments } from '../../related-instruments'
import { fetchSlowData } from '../../slow-data'
import type { PriceSeriesIo } from './price-series-packet'

/**
 * The REAL fetchers behind `buildPriceSeriesPacket` — exactly the modules the
 * orchestrator called inline before the adapter move. Kept in a separate
 * 'server-only' file so the pure assembly (and every gateway test) never
 * transitively imports network/DB code.
 */
export const LIVE_PRICE_SERIES_IO: PriceSeriesIo = {
  fetchDataPacket,
  fetchMarketConsensus,
  fetchCryptoContext,
  getResearchPacket,
  fetchRelatedInstruments,
  fetchSlowData,
}
