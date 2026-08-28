/**
 * AI Prediction League — CROSS-ASSET RELATIONS MAP (CONFIG, not code).
 *
 * Packet v2 (A): for each catalog instrument, the related series a
 * single-asset analyst would NOT assemble — sector ETF, index proxy,
 * volatility proxy, relevant FX, relevant commodity proxy, and 2–3
 * supply-chain/peer tickers. The orchestrator fetches each related series
 * (Twelve Data `time_series`, 1 credit each) and prints LOCALLY COMPUTED
 * numbers (corr/beta/lead-lag — see `related-stats.ts`), never raw series.
 *
 * CONSTRAINT: every symbol here must be fetchable on the Twelve Data free
 * (Basic) tier — US equities/ETFs, FX pairs, crypto pairs. Index symbols
 * (SPX/NDX/VIX) are NOT free-tier, so ETF proxies stand in (SPY/QQQ/VIXY).
 * A symbol the plan rejects degrades to an UNAVAILABLE line, never a guess.
 *
 * Editing this file is a data edit (like roster.ts): add/remove a relation,
 * no engine change.
 */

export type RelationRole =
  | 'sector_etf'
  | 'index_proxy'
  | 'vol_proxy'
  | 'fx'
  | 'commodity_proxy'
  | 'peer'

/** Non-English research languages the director may query for this instrument. */
export type ResearchLang = 'ko' | 'ja' | 'zh'

export type RelatedRef = {
  /** Twelve Data-mappable symbol (see mapInstrumentToTwelveData). */
  symbol: string
  role: RelationRole
  /** Short human note printed in the packet so the relation is legible. */
  note: string
}

export type RelationsEntry = {
  instrument: string
  related: readonly RelatedRef[]
  /**
   * (B) Asia-linked flag: languages the research director should ALSO query
   * (results go into the SHARED packet for all closed-book models).
   */
  asiaLinks: readonly ResearchLang[]
}

/**
 * Shared heavyweights cached by (symbol, UTC day) — after the first round of
 * the day they cost 0 further Twelve Data credits for every other round.
 * (The day-cache in `related-instruments.ts` actually caches EVERY related
 * symbol; this list documents the ones shared across many instruments.)
 */
export const RELATED_HEAVYWEIGHTS = ['SPY', 'QQQ', 'VIXY', 'UUP', 'TLT'] as const

const VOL: RelatedRef = { symbol: 'VIXY', role: 'vol_proxy', note: 'VIX short-term futures ETF (risk appetite)' }
const DOLLAR: RelatedRef = { symbol: 'UUP', role: 'fx', note: 'USD index ETF proxy (dollar strength)' }
const RATES: RelatedRef = { symbol: 'TLT', role: 'index_proxy', note: '20y+ Treasury ETF (US rates proxy; price up = yields down)' }

export const RELATIONS_MAP: readonly RelationsEntry[] = [
  {
    instrument: 'AAPL',
    related: [
      { symbol: 'XLK', role: 'sector_etf', note: 'S&P tech sector' },
      { symbol: 'QQQ', role: 'index_proxy', note: 'Nasdaq-100 proxy' },
      VOL,
      { symbol: 'USD/CNH', role: 'fx', note: 'offshore yuan — China revenue/supply exposure' },
      { symbol: 'TSM', role: 'peer', note: 'sole chip foundry supplier' },
      { symbol: 'MSFT', role: 'peer', note: 'megacap tech peer' },
    ],
    asiaLinks: ['zh'],
  },
  {
    instrument: 'NVDA',
    related: [
      { symbol: 'SMH', role: 'sector_etf', note: 'semiconductor sector' },
      { symbol: 'QQQ', role: 'index_proxy', note: 'Nasdaq-100 proxy' },
      VOL,
      { symbol: 'USD/TWD', role: 'fx', note: 'Taiwan dollar — TSMC supply chain' },
      { symbol: 'TSM', role: 'peer', note: 'foundry supplier' },
      { symbol: 'AMD', role: 'peer', note: 'GPU competitor' },
    ],
    asiaLinks: ['zh', 'ko'],
  },
  {
    instrument: 'TSLA',
    related: [
      { symbol: 'XLY', role: 'sector_etf', note: 'consumer discretionary sector' },
      { symbol: 'QQQ', role: 'index_proxy', note: 'Nasdaq-100 proxy' },
      VOL,
      { symbol: 'USD/CNH', role: 'fx', note: 'yuan — Shanghai plant + China demand' },
      { symbol: 'LIT', role: 'commodity_proxy', note: 'lithium/battery ETF (input costs)' },
      { symbol: 'NIO', role: 'peer', note: 'China EV competitor (US-listed)' },
    ],
    asiaLinks: ['zh'],
  },
  {
    instrument: 'BTC/USD',
    related: [
      { symbol: 'ETH/USD', role: 'peer', note: 'second-largest crypto — co-moves' },
      { symbol: 'QQQ', role: 'index_proxy', note: 'risk-asset appetite proxy' },
      VOL,
      DOLLAR,
      { symbol: 'GLD', role: 'commodity_proxy', note: 'gold ETF — store-of-value analogue' },
    ],
    asiaLinks: ['ko'],
  },
  {
    instrument: 'ETH/USD',
    related: [
      { symbol: 'BTC/USD', role: 'peer', note: 'crypto benchmark — leads alt moves' },
      { symbol: 'SOL/USD', role: 'peer', note: 'competing L1' },
      { symbol: 'QQQ', role: 'index_proxy', note: 'risk-asset appetite proxy' },
      DOLLAR,
    ],
    asiaLinks: ['ko'],
  },
  {
    instrument: 'SOL/USD',
    related: [
      { symbol: 'BTC/USD', role: 'peer', note: 'crypto benchmark' },
      { symbol: 'ETH/USD', role: 'peer', note: 'competing L1' },
      DOLLAR,
      VOL,
    ],
    asiaLinks: ['ko'],
  },
  {
    instrument: 'EUR/USD',
    related: [
      DOLLAR,
      { symbol: 'GBP/USD', role: 'peer', note: 'co-moving European pair' },
      { symbol: 'USD/CHF', role: 'peer', note: 'inverse-correlated franc pair' },
      VOL,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'USD/KRW',
    related: [
      { symbol: 'USD/JPY', role: 'peer', note: 'co-moving Asian dollar pair' },
      { symbol: 'USD/CNH', role: 'peer', note: 'yuan — KRW tracks CNH regionally' },
      { symbol: 'EWY', role: 'index_proxy', note: 'Korea equity ETF (won risk sentiment)' },
      DOLLAR,
    ],
    asiaLinks: ['ko'],
  },
  {
    instrument: 'USD/JPY',
    related: [
      DOLLAR,
      RATES,
      { symbol: 'EWJ', role: 'index_proxy', note: 'Japan equity ETF' },
      { symbol: 'USD/KRW', role: 'peer', note: 'co-moving Asian dollar pair' },
    ],
    asiaLinks: ['ja'],
  },
  {
    instrument: 'XAU/USD',
    related: [
      { symbol: 'GDX', role: 'peer', note: 'gold miners ETF — levered gold beta' },
      { symbol: 'XAG/USD', role: 'peer', note: 'silver — co-moving metal' },
      DOLLAR,
      { symbol: 'TIP', role: 'index_proxy', note: 'TIPS ETF (real-rate proxy; real rates drive gold)' },
      VOL,
    ],
    asiaLinks: ['zh'],
  },
  {
    instrument: 'XAG/USD',
    related: [
      { symbol: 'XAU/USD', role: 'peer', note: 'gold — co-moving metal' },
      { symbol: 'SIL', role: 'peer', note: 'silver miners ETF' },
      { symbol: 'COPX', role: 'commodity_proxy', note: 'copper miners — industrial-demand side of silver' },
      DOLLAR,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'SPX',
    related: [
      { symbol: 'SPY', role: 'index_proxy', note: 'S&P 500 ETF (tracks the index)' },
      VOL,
      RATES,
      { symbol: 'HYG', role: 'index_proxy', note: 'high-yield credit ETF (risk stress gauge)' },
      DOLLAR,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'NDX',
    related: [
      { symbol: 'QQQ', role: 'index_proxy', note: 'Nasdaq-100 ETF (tracks the index)' },
      { symbol: 'SMH', role: 'sector_etf', note: 'semis — NDX heavyweight sector' },
      VOL,
      RATES,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'WTICO/USD',
    related: [
      { symbol: 'XLE', role: 'sector_etf', note: 'energy equities' },
      { symbol: 'NATGAS/USD', role: 'peer', note: 'co-moving energy commodity' },
      DOLLAR,
      VOL,
    ],
    asiaLinks: ['zh'],
  },
  {
    instrument: 'NATGAS/USD',
    related: [
      { symbol: 'WTICO/USD', role: 'peer', note: 'co-moving energy commodity' },
      { symbol: 'XLE', role: 'sector_etf', note: 'energy equities' },
      DOLLAR,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'DOGE/USD',
    related: [
      { symbol: 'BTC/USD', role: 'peer', note: 'crypto benchmark — memecoins beta to BTC' },
      { symbol: 'ETH/USD', role: 'peer', note: 'major-alt benchmark' },
      { symbol: 'SHIB/USD', role: 'peer', note: 'co-moving memecoin' },
      VOL,
    ],
    asiaLinks: ['ko'],
  },
  {
    instrument: 'SHIB/USD',
    related: [
      { symbol: 'BTC/USD', role: 'peer', note: 'crypto benchmark' },
      { symbol: 'DOGE/USD', role: 'peer', note: 'co-moving memecoin' },
      { symbol: 'ETH/USD', role: 'peer', note: 'major-alt benchmark' },
    ],
    asiaLinks: ['ko'],
  },
  {
    instrument: 'VNQ',
    related: [
      { symbol: 'XLRE', role: 'sector_etf', note: 'real-estate sector' },
      RATES,
      { symbol: 'SPY', role: 'index_proxy', note: 'broad equity beta' },
      { symbol: 'SCHH', role: 'peer', note: 'competing REIT ETF' },
    ],
    asiaLinks: [],
  },
  {
    instrument: 'SCHH',
    related: [
      { symbol: 'XLRE', role: 'sector_etf', note: 'real-estate sector' },
      RATES,
      { symbol: 'VNQ', role: 'peer', note: 'competing REIT ETF' },
    ],
    asiaLinks: [],
  },
]

const BY_INSTRUMENT = new Map(RELATIONS_MAP.map((e) => [e.instrument, e]))

export function relationsFor(instrument: string): RelationsEntry | null {
  return BY_INSTRUMENT.get(instrument.trim()) ?? null
}
