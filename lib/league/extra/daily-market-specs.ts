/**
 * Which real money markets can price a league price round, per instrument.
 * Series tickers were checked against the public Kalshi API (2026-10-06).
 *
 * reference 'anchor': the venue settles on the same price the round anchors on
 *   (spot BTC/ETH/gold/FX), so P(close above the round's anchor) is read straight
 *   off the strike ladder.
 * reference 'venue': the venue settles on a different unit (S&P 500 points vs
 *   SPY, front-month WTI futures vs spot), so the reference is the venue's own
 *   settled value nearest the round's start, taken from `referenceSeries`.
 */

export type DailyMarketReference = 'anchor' | 'venue'

export type DailyMarketSpec = {
  instrument: string
  underlying: string
  kalshiSeries: readonly string[]
  reference: DailyMarketReference
  referenceSeries: string | null
  /** Polymarket "<Asset> Up or Down on <date>" daily markets. */
  polymarketAsset: string | null
  /** How closely the venue's underlying tracks the instrument, before the time-window factor. */
  assetRelevance: number
}

const SPECS: readonly DailyMarketSpec[] = [
  {
    instrument: 'SPY',
    underlying: 'S&P 500',
    kalshiSeries: ['KXINX', 'KXINXW'],
    reference: 'venue',
    referenceSeries: 'KXINX',
    polymarketAsset: null,
    assetRelevance: 0.95,
  },
  {
    instrument: 'QQQ',
    underlying: 'Nasdaq-100',
    kalshiSeries: ['KXNASDAQ100', 'KXNASDAQ100W'],
    reference: 'venue',
    referenceSeries: 'KXNASDAQ100',
    polymarketAsset: null,
    assetRelevance: 0.95,
  },
  {
    instrument: 'EUR/USD',
    underlying: 'EUR/USD',
    kalshiSeries: ['KXEURUSD', 'KXEURUSDW'],
    reference: 'anchor',
    referenceSeries: null,
    polymarketAsset: null,
    assetRelevance: 0.95,
  },
  {
    instrument: 'USD/JPY',
    underlying: 'USD/JPY',
    kalshiSeries: ['KXUSDJPY', 'KXUSDJPYW'],
    reference: 'anchor',
    referenceSeries: null,
    polymarketAsset: null,
    assetRelevance: 0.95,
  },
  {
    instrument: 'XAU/USD',
    underlying: 'Gold',
    kalshiSeries: ['KXGOLDD', 'KXGOLDW'],
    reference: 'anchor',
    referenceSeries: null,
    polymarketAsset: null,
    assetRelevance: 0.95,
  },
  {
    instrument: 'WTI/USD',
    underlying: 'WTI crude',
    kalshiSeries: ['KXWTI', 'KXWTIW'],
    reference: 'venue',
    referenceSeries: 'KXWTI',
    polymarketAsset: null,
    assetRelevance: 0.9,
  },
  {
    instrument: 'BTC/USD',
    underlying: 'Bitcoin',
    kalshiSeries: ['KXBTCD'],
    reference: 'anchor',
    referenceSeries: null,
    polymarketAsset: 'Bitcoin',
    assetRelevance: 0.95,
  },
  {
    instrument: 'ETH/USD',
    underlying: 'Ethereum',
    kalshiSeries: ['KXETHD'],
    reference: 'anchor',
    referenceSeries: null,
    polymarketAsset: 'Ethereum',
    assetRelevance: 0.95,
  },
  {
    instrument: 'SOL/USD',
    underlying: 'Solana',
    kalshiSeries: [],
    reference: 'anchor',
    referenceSeries: null,
    polymarketAsset: 'Solana',
    assetRelevance: 0.95,
  },
  {
    instrument: 'XRP/USD',
    underlying: 'XRP',
    kalshiSeries: [],
    reference: 'anchor',
    referenceSeries: null,
    polymarketAsset: 'XRP',
    assetRelevance: 0.95,
  },
]

const BY_INSTRUMENT = new Map(SPECS.map((spec) => [spec.instrument, spec]))

export function dailyMarketSpec(instrument: string | null | undefined): DailyMarketSpec | null {
  if (!instrument) return null
  return BY_INSTRUMENT.get(instrument.trim().toUpperCase()) ?? null
}

export function dailyMarketInstruments(): string[] {
  return SPECS.map((spec) => spec.instrument)
}
