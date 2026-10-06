import { describe, expect, it } from 'vitest'
import { searchDailyMarkets } from '../extra/daily-market-search'
import { probabilityAbove, pickDailyMarket, type DailyMarketCandidate } from '../extra/daily-markets'
import { marketRationale, pricedMarketPath, recordForMatch } from '../extra/market-match'
import { matchSportsBaseline, subjectWinProbability, type SportsBaselineDeps } from '../extra/sports-baseline'
import { apiFootballDevig } from '../sports/api-football-odds'
import { multiplicativeDevig, shinDevig } from '../sports/devig'
import type { DevigResult } from '../sports/types'
import { SPORTS_UI_BANNED_RE } from '../sports-market'

const ODDS = [2, 3.4, 4]

function devigFixture(): DevigResult {
  const parsed = apiFootballDevig(
    {
      response: [
        {
          bookmakers: [
            {
              name: 'Pinnacle',
              bets: [
                {
                  id: 1,
                  name: 'Match Winner',
                  values: [
                    { value: 'Home', odd: '2.00' },
                    { value: 'Draw', odd: '3.40' },
                    { value: 'Away', odd: '4.00' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { home: 'Arsenal', away: 'Chelsea' },
  )
  if (!parsed) throw new Error('fixture did not de-vig')
  return parsed
}

describe('priced market path by category', () => {
  it('routes tech and AI ranking to an event market, listed underlyings to daily markets, and sports to the book', () => {
    expect(pricedMarketPath('tech', 'TECH:OPEN')).toBe('event')
    expect(pricedMarketPath('ai_models', 'AIRANK:best')).toBe('event')
    for (const instrument of ['SPY', 'QQQ', 'EUR/USD', 'USD/JPY', 'XAU/USD', 'WTI/USD', 'BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD']) {
      expect(pricedMarketPath('crypto', instrument), instrument).toBe('daily')
    }
    expect(pricedMarketPath('sports', 'MATCH:soccer_epl:af-1:home:1:A:B')).toBe('sports')
    expect(pricedMarketPath('stock', '005930')).toBeNull()
    expect(pricedMarketPath('politics', 'ELECTION:kr')).toBeNull()
    expect(pricedMarketPath('real_estate', 'HOUSING:seoul')).toBeNull()
  })
})

describe('daily price ladders', () => {
  it('reads P(settle above the reference) off a Kalshi strike ladder', () => {
    const above = probabilityAbove(
      [
        { ticker: 'LO', strikeType: 'greater', floor: 59_000, cap: null, yes: 0.56 },
        { ticker: 'HI', strikeType: 'greater', floor: 61_000, cap: null, yes: 0.44 },
      ],
      60_000,
    )
    expect(above).toEqual({ probability: 0.5, ticker: 'LO' })
    expect(probabilityAbove([], 60_000)).toBeNull()
  })

  it('keeps a same-window daily market and drops one outside the 7-day gate', () => {
    const roundWindow = { startMs: Date.parse('2026-10-07T00:00:00.000Z'), endMs: Date.parse('2026-10-08T00:00:00.000Z') }
    const aligned: DailyMarketCandidate = {
      venue: 'kalshi',
      id: 'KXBTCD-ALIGNED',
      title: 'Bitcoin above 60,000',
      outcome: 'above 60,000',
      impliedYes: 0.5,
      resolvesAt: '2026-10-08T00:00:00.000Z',
      windowStartMs: roundWindow.startMs,
    }
    const late: DailyMarketCandidate = { ...aligned, id: 'KXBTCD-LATE', resolvesAt: '2026-10-20T00:00:00.000Z' }
    const picked = pickDailyMarket({ candidates: [late, aligned], roundWindow, spec: { assetRelevance: 0.95 } })
    expect(picked?.id).toBe('KXBTCD-ALIGNED')
    expect(picked?.kind).toBe('price_direction')
    expect(picked?.relevance).toBeGreaterThanOrEqual(0.7)
    expect(pickDailyMarket({ candidates: [late], roundWindow, spec: { assetRelevance: 0.95 } })).toBeNull()
  })
})

describe('Polymarket blocked from Korea', () => {
  it('logs provider_unavailable on 451 and still prices the round from Kalshi', async () => {
    const logs: Array<{ provider: string; status: string }> = []
    const match = await searchDailyMarkets(
      {
        category: 'crypto',
        instrument: 'BTC/USD',
        resolves_at: '2026-10-08T00:00:00.000Z',
        opened_at: '2026-10-07T00:00:00.000Z',
        anchor_price: 60_000,
      },
      {
        log: (event) => logs.push({ provider: event.provider, status: event.status }),
        fetchImpl: async (url) => {
          const href = String(url)
          if (href.includes('public-search')) return new Response('blocked', { status: 451 })
          if (href.includes('status=open')) {
            return Response.json({
              events: [
                {
                  event_ticker: 'KXBTCD-26OCT08',
                  series_ticker: 'KXBTCD',
                  strike_date: '2026-10-08T00:00:00.000Z',
                },
              ],
            })
          }
          if (href.includes('KXBTCD-26OCT08')) {
            return Response.json({
              markets: [
                {
                  ticker: 'KXBTCD-T59000',
                  strike_type: 'greater',
                  floor_strike: 59_000,
                  status: 'active',
                  yes_bid_dollars: '0.55',
                  yes_ask_dollars: '0.57',
                },
                {
                  ticker: 'KXBTCD-T61000',
                  strike_type: 'greater',
                  floor_strike: 61_000,
                  status: 'active',
                  yes_bid_dollars: '0.43',
                  yes_ask_dollars: '0.45',
                },
              ],
            })
          }
          return new Response('missing', { status: 404 })
        },
      },
    )
    expect(logs).toContainEqual({ provider: 'polymarket', status: '451' })
    expect(match?.venue).toBe('kalshi')
    expect(match?.id).toBe('KXBTCD-26OCT08')
    expect(match?.kind).toBe('price_direction')
    expect(match && recordForMatch(match).consensus_source).toBe('kalshi')
    expect(match && recordForMatch(match).consensus_market_id).toBe('KXBTCD-26OCT08')
  })
})

describe('sports book de-vig', () => {
  it('removes the overround so the three prices sum to 1 and the favorite keeps less than its raw price', () => {
    const raw = ODDS.map((o) => 1 / o)
    expect(raw.reduce((s, p) => s + p, 0)).toBeGreaterThan(1)
    const proportional = multiplicativeDevig(ODDS)
    const shin = shinDevig(ODDS)
    expect(proportional.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 6)
    expect(shin.probabilities.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 6)
    expect(shin.z).toBeGreaterThan(0)
    expect(shin.probabilities[0]).toBeGreaterThan(proportional[0]!)
    expect(shin.probabilities[0]).toBeLessThan(raw[0]!)

    const devig = devigFixture()
    expect(devig.bookKey).toBe('pinnacle')
    expect(devig.outcomes.map((o) => o.name)).toEqual(['Arsenal', 'Draw', 'Chelsea'])
    expect(devig.outcomes.reduce((s, o) => s + o.probability, 0)).toBeCloseTo(1, 5)
    expect(subjectWinProbability(devig, 'Arsenal')).toBeCloseTo(shin.probabilities[0]!, 5)
  })

  it('prices the named team from cached odds, and from API-Football only for an af- football fixture', async () => {
    const devig = devigFixture()
    const kickoffMs = Date.parse('2026-10-10T15:00:00.000Z')
    const deadline = '2026-10-10T18:00:00.000Z'
    let fetched = 0
    const deps = (cached: DevigResult | null): SportsBaselineDeps => ({
      readCachedOdds: async () => (cached ? { devig: cached, kickoff: new Date(kickoffMs).toISOString() } : null),
      fetchApiFootballOdds: async () => {
        fetched += 1
        return devig
      },
    })

    const fromCache = await matchSportsBaseline(
      { instrument: `MATCH:soccer_epl:evt-9:home:${kickoffMs}:Arsenal:Chelsea`, resolves_at: deadline },
      deps(devig),
    )
    expect(fromCache?.venue).toBe('odds_api')
    expect(fromCache?.id).toBe('evt-9')
    expect(fromCache?.outcome).toBe('Arsenal')
    expect(fetched).toBe(0)
    const rationale = marketRationale(fromCache!)
    expect(rationale).toContain('Arsenal')
    expect(rationale).not.toContain('Pinnacle')
    expect(rationale).not.toMatch(SPORTS_UI_BANNED_RE)
    expect(recordForMatch(fromCache!).consensus_source).toBe('odds_api')

    const fromApi = await matchSportsBaseline(
      { instrument: `MATCH:soccer_epl:af-1507081:home:${kickoffMs}:Arsenal:Chelsea`, resolves_at: deadline },
      deps(null),
    )
    expect(fetched).toBe(1)
    expect(fromApi?.venue).toBe('api_football')
    expect(fromApi?.outcome).toBe('Arsenal')
    expect(recordForMatch(fromApi!).consensus_market_id).toBe('af-1507081')

    fetched = 0
    const bareMlb = await matchSportsBaseline(
      { instrument: `MATCH:baseball_mlb:12345:away:${kickoffMs}:San%20Francisco%20Giants:Los%20Angeles%20Dodgers`, resolves_at: deadline },
      deps(null),
    )
    expect(bareMlb).toBeNull()
    expect(fetched).toBe(0)

    const stale = await matchSportsBaseline(
      { instrument: `MATCH:soccer_epl:evt:home:${kickoffMs}:Arsenal:Chelsea`, resolves_at: '2026-11-20T18:00:00.000Z' },
      deps(devig),
    )
    expect(stale).toBeNull()
  })
})
