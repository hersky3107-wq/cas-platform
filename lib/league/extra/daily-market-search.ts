/**
 * Live daily/weekly price markets for the consensus extra seat.
 * Polymarket and Kalshi are queried side by side. Polymarket answers 451 to
 * Korean IPs: that logs provider_unavailable and the Kalshi ladders still
 * decide, so local runs fall back to Kalshi. No proxy and no second route.
 */
import { POLYMARKET_GAMMA_ORIGIN } from '../politics/markets'
import { dailyMarketSpec, type DailyMarketSpec } from './daily-market-specs'
import {
  kalshiLadderCandidate,
  parseKalshiEventList,
  parseKalshiEventMarkets,
  parseKalshiSettledValues,
  parsePolymarketDailyUpDown,
  pickDailyMarket,
  rankKalshiEvents,
  roundPriceWindow,
  venueReferenceFor,
  type DailyMarketCandidate,
  type PriceRoundTiming,
  type PriceWindow,
} from './daily-markets'
import type { AcceptedMarketMatch } from './market-match'
import { fetchVenueJson, type SearchOpts } from './market-search'

export const KALSHI_TRADE_API = 'https://api.elections.kalshi.com/trade-api/v2'

export type DailyMarketRound = PriceRoundTiming & { anchor_price?: number | null }

export function kalshiOpenEventsUrl(series: string): string {
  const q = new URLSearchParams({ series_ticker: series, status: 'open', limit: '100' })
  return `${KALSHI_TRADE_API}/events?${q.toString()}`
}

export function kalshiEventUrl(eventTicker: string): string {
  return `${KALSHI_TRADE_API}/events/${encodeURIComponent(eventTicker)}`
}

export function kalshiSettledEventsUrl(series: string): string {
  const q = new URLSearchParams({
    series_ticker: series,
    status: 'settled',
    with_nested_markets: 'true',
    limit: '10',
  })
  return `${KALSHI_TRADE_API}/events?${q.toString()}`
}

export function polymarketDailyUpDownUrl(asset: string): string {
  const q = new URLSearchParams({ q: `${asset} Up or Down`, limit_per_type: '20' })
  return `${POLYMARKET_GAMMA_ORIGIN}/public-search?${q.toString()}`
}

export async function searchDailyMarkets(
  round: DailyMarketRound,
  opts: SearchOpts = {},
): Promise<AcceptedMarketMatch | null> {
  const spec = dailyMarketSpec(round.instrument)
  if (!spec) return null
  const window = roundPriceWindow(round)
  if (!window) return null
  const [polymarket, kalshi] = await Promise.all([
    spec.polymarketAsset ? polymarketCandidates(spec.polymarketAsset, opts) : Promise.resolve([]),
    kalshiCandidates(spec, round, window, opts),
  ])
  return pickDailyMarket({ candidates: [...polymarket, ...kalshi], roundWindow: window, spec })
}

async function polymarketCandidates(asset: string, opts: SearchOpts): Promise<DailyMarketCandidate[]> {
  const body = await fetchVenueJson('polymarket', polymarketDailyUpDownUrl(asset), opts)
  return body == null ? [] : parsePolymarketDailyUpDown(body, asset)
}

async function kalshiReference(
  spec: DailyMarketSpec,
  round: DailyMarketRound,
  window: PriceWindow,
  opts: SearchOpts,
): Promise<{ value: number; startMs: number } | null> {
  if (spec.reference === 'anchor') {
    const value = round.anchor_price
    return value != null && Number.isFinite(value) && value > 0 ? { value, startMs: window.startMs } : null
  }
  if (!spec.referenceSeries) return null
  const body = await fetchVenueJson('kalshi', kalshiSettledEventsUrl(spec.referenceSeries), opts)
  if (body == null) return null
  const settled = venueReferenceFor(parseKalshiSettledValues(body), window.startMs)
  return settled ? { value: settled.value, startMs: Date.parse(settled.strikeAt) } : null
}

async function kalshiCandidates(
  spec: DailyMarketSpec,
  round: DailyMarketRound,
  window: PriceWindow,
  opts: SearchOpts,
): Promise<DailyMarketCandidate[]> {
  if (spec.kalshiSeries.length === 0) return []
  const reference = await kalshiReference(spec, round, window, opts)
  if (!reference) return []
  const perSeries = await Promise.all(
    spec.kalshiSeries.map(async (series) => {
      const body = await fetchVenueJson('kalshi', kalshiOpenEventsUrl(series), opts)
      if (body == null) return []
      return rankKalshiEvents(parseKalshiEventList(body), window, reference.startMs).slice(0, 1)
    }),
  )
  const ladders = await Promise.all(
    perSeries.flat().map(async (event) => {
      const body = await fetchVenueJson('kalshi', kalshiEventUrl(event.eventTicker), opts)
      if (body == null) return null
      return kalshiLadderCandidate({
        event,
        markets: parseKalshiEventMarkets(body),
        reference: reference.value,
        referenceStartMs: reference.startMs,
        underlying: spec.underlying,
      })
    }),
  )
  return ladders.filter((c): c is DailyMarketCandidate => c != null)
}
