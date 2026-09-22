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
 * CONSTRAINT: every symbol here must be fetchable on the current Twelve Data
 * Grow plan — US equities/ETFs, FX, crypto, commodity spots (XAU/XAG/XPT/WTI/XBR).
 * Cash-index tickers (SPX/NDX/VIX) and SPXS are poison: they HTTP-200 as
 * unrelated equities. The catalog lists SPY/QQQ/DIA and country ETFs, never
 * SPX/NDX/DJI, and never SPXS (UCITS identity trap).
 * A symbol the plan rejects, or whose resolved NAME fails expected_name,
 * degrades to an UNAVAILABLE line, never a guess.
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
      { symbol: 'FXE', role: 'peer', note: 'CurrencyShares Euro Trust — listed euro proxy' },
      { symbol: 'EZU', role: 'index_proxy', note: 'iShares MSCI Eurozone — euro-area equity beta' },
      { symbol: 'GBP/USD', role: 'peer', note: 'co-moving European pair' },
      DOLLAR,
      VOL,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'USD/KRW',
    related: [
      { symbol: 'EWY', role: 'index_proxy', note: 'Korea equity ETF (won risk sentiment)' },
      { symbol: 'USD/JPY', role: 'peer', note: 'co-moving Asian dollar pair' },
      { symbol: 'USD/CNH', role: 'peer', note: 'yuan — KRW tracks CNH regionally' },
      DOLLAR,
    ],
    asiaLinks: ['ko'],
  },
  {
    instrument: 'USD/JPY',
    related: [
      { symbol: 'FXY', role: 'peer', note: 'CurrencyShares Yen Trust — listed yen proxy' },
      { symbol: 'EWJ', role: 'index_proxy', note: 'Japan equity ETF' },
      DOLLAR,
      RATES,
      { symbol: 'USD/KRW', role: 'peer', note: 'co-moving Asian dollar pair' },
    ],
    asiaLinks: ['ja'],
  },
  {
    instrument: 'GBP/USD',
    related: [
      { symbol: 'FXB', role: 'peer', note: 'CurrencyShares Pound Trust — listed sterling proxy' },
      { symbol: 'EUR/USD', role: 'peer', note: 'co-moving European pair' },
      DOLLAR,
      VOL,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'USD/CNH',
    related: [
      { symbol: 'USD/KRW', role: 'peer', note: 'KRW — regional dollar/Asia EM pair' },
      { symbol: 'USD/JPY', role: 'peer', note: 'JPY — Asia dollar pair' },
      DOLLAR,
    ],
    asiaLinks: ['zh'],
  },
  {
    instrument: 'AUD/USD',
    related: [
      { symbol: 'USD/CNH', role: 'fx', note: 'offshore yuan — China demand for Australian exports' },
      { symbol: 'USD/JPY', role: 'peer', note: 'risk-sensitive dollar pair' },
      DOLLAR,
    ],
    asiaLinks: ['zh'],
  },
  {
    instrument: 'JPY/KRW',
    related: [
      { symbol: 'EWY', role: 'index_proxy', note: 'Korea equity ETF — won risk sentiment' },
      { symbol: 'EWJ', role: 'index_proxy', note: 'Japan equity ETF — yen risk sentiment' },
      { symbol: 'USD/KRW', role: 'peer', note: 'USD/KRW leg of the cross' },
      { symbol: 'USD/JPY', role: 'peer', note: 'USD/JPY leg of the cross' },
    ],
    asiaLinks: ['ko', 'ja'],
  },
  {
    instrument: 'EUR/JPY',
    related: [
      { symbol: 'FXE', role: 'peer', note: 'CurrencyShares Euro Trust' },
      { symbol: 'FXY', role: 'peer', note: 'CurrencyShares Yen Trust' },
      { symbol: 'EUR/USD', role: 'peer', note: 'EUR/USD leg of the cross' },
      { symbol: 'USD/JPY', role: 'peer', note: 'USD/JPY leg of the cross' },
    ],
    asiaLinks: ['ja'],
  },
  {
    instrument: 'GBP/JPY',
    related: [
      { symbol: 'FXB', role: 'peer', note: 'CurrencyShares Pound Trust' },
      { symbol: 'FXY', role: 'peer', note: 'CurrencyShares Yen Trust' },
      { symbol: 'GBP/USD', role: 'peer', note: 'GBP/USD leg of the cross' },
      { symbol: 'USD/JPY', role: 'peer', note: 'USD/JPY leg of the cross' },
    ],
    asiaLinks: ['ja'],
  },
  {
    instrument: 'XAU/USD',
    related: [
      { symbol: 'GLD', role: 'peer', note: 'SPDR gold ETF — US-listed physical gold' },
      { symbol: 'XAG/USD', role: 'peer', note: 'spot silver — co-moving metal (calendar clock)' },
      { symbol: 'SLV', role: 'peer', note: 'iShares silver ETF — co-moving metal (NYSE session)' },
      DOLLAR,
      { symbol: 'TIP', role: 'index_proxy', note: 'TIPS ETF (real-rate proxy; real rates drive gold)' },
      VOL,
    ],
    asiaLinks: ['zh'],
  },
  {
    instrument: 'GLD',
    related: [
      { symbol: 'XAU/USD', role: 'commodity_proxy', note: 'spot gold — the ETF tracks this' },
      { symbol: 'XAG/USD', role: 'peer', note: 'spot silver — co-moving metal (calendar clock)' },
      { symbol: 'SLV', role: 'peer', note: 'iShares silver ETF — co-moving metal' },
      DOLLAR,
      { symbol: 'TIP', role: 'index_proxy', note: 'TIPS ETF (real-rate proxy; real rates drive gold)' },
      VOL,
    ],
    asiaLinks: ['zh'],
  },
  {
    instrument: 'SLV',
    related: [
      { symbol: 'XAU/USD', role: 'commodity_proxy', note: 'spot gold — co-moving metal' },
      { symbol: 'XAG/USD', role: 'commodity_proxy', note: 'spot silver — the ETF tracks this' },
      { symbol: 'GLD', role: 'peer', note: 'SPDR gold ETF — co-moving metal ETF' },
      DOLLAR,
      { symbol: 'TIP', role: 'index_proxy', note: 'TIPS ETF (real-rate proxy)' },
      VOL,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'XAG/USD',
    related: [
      { symbol: 'TAN', role: 'sector_etf', note: 'Invesco Solar ETF — silver industrial (PV) demand proxy' },
      { symbol: 'SLV', role: 'peer', note: 'iShares silver ETF — US-listed, NYSE session' },
      { symbol: 'XAU/USD', role: 'peer', note: 'spot gold — co-moving metal' },
      { symbol: 'GLD', role: 'peer', note: 'SPDR gold ETF — co-moving metal ETF' },
      DOLLAR,
      { symbol: 'TIP', role: 'index_proxy', note: 'TIPS ETF (real-rate proxy)' },
      VOL,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'XPT/USD',
    related: [
      { symbol: 'PALL', role: 'peer', note: 'abrdn physical palladium ETF — Pt/Pd substitute metal' },
      { symbol: 'XAU/USD', role: 'peer', note: 'spot gold — co-moving precious metal' },
      { symbol: 'XAG/USD', role: 'peer', note: 'spot silver — co-moving precious metal' },
      { symbol: 'GLD', role: 'peer', note: 'SPDR gold ETF — co-moving metal ETF' },
      DOLLAR,
      { symbol: 'TIP', role: 'index_proxy', note: 'TIPS ETF (real-rate proxy; real rates drive precious metals)' },
      VOL,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'SPY',
    related: [
      { symbol: 'QQQ', role: 'index_proxy', note: 'Nasdaq-100 ETF (risk-asset peer)' },
      { symbol: 'XLF', role: 'sector_etf', note: 'financials — S&P heavyweight sector' },
      VOL,
      RATES,
      { symbol: 'HYG', role: 'index_proxy', note: 'high-yield credit ETF (risk stress gauge)' },
      DOLLAR,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'QQQ',
    related: [
      { symbol: 'SPY', role: 'index_proxy', note: 'S&P 500 ETF (broad-market peer)' },
      { symbol: 'SMH', role: 'sector_etf', note: 'semis — QQQ heavyweight sector' },
      { symbol: 'XLK', role: 'sector_etf', note: 'S&P tech sector' },
      VOL,
      RATES,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'DIA',
    related: [
      { symbol: 'SPY', role: 'index_proxy', note: 'S&P 500 ETF (broad-market peer)' },
      { symbol: 'XLF', role: 'sector_etf', note: 'financials — Dow heavyweight sector' },
      VOL,
      RATES,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'EWJ',
    related: [
      { symbol: 'FXY', role: 'fx', note: 'CurrencyShares Yen Trust — yen proxy' },
      { symbol: 'USD/JPY', role: 'fx', note: 'dollar-yen — Japan risk/rate pair' },
      VOL,
      RATES,
    ],
    asiaLinks: ['ja'],
  },
  {
    instrument: 'EWY',
    related: [
      { symbol: 'USD/KRW', role: 'fx', note: 'dollar-won — Korea risk pair' },
      { symbol: 'FXI', role: 'index_proxy', note: 'China large-cap — regional equity beta' },
      { symbol: 'SPY', role: 'index_proxy', note: 'US beta (Korea trades with global risk)' },
      VOL,
    ],
    asiaLinks: ['ko'],
  },
  {
    instrument: 'FEZ',
    related: [
      { symbol: 'EZU', role: 'index_proxy', note: 'MSCI Eurozone — broader euro-area peer' },
      { symbol: 'FXE', role: 'fx', note: 'CurrencyShares Euro Trust' },
      { symbol: 'SPY', role: 'index_proxy', note: 'US beta' },
      VOL,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'EWT',
    related: [
      { symbol: 'SMH', role: 'sector_etf', note: 'semis — TSMC is EWT’s heavyweight' },
      { symbol: 'FXI', role: 'index_proxy', note: 'China large-cap — regional peer' },
      VOL,
    ],
    asiaLinks: ['zh'],
  },
  {
    instrument: 'TQQQ',
    related: [
      { symbol: 'QQQ', role: 'index_proxy', note: 'unlevered Nasdaq-100 — TQQQ is +3x this' },
      { symbol: 'SMH', role: 'sector_etf', note: 'semis — QQQ/TQQQ heavyweight sector' },
      { symbol: 'XLK', role: 'sector_etf', note: 'S&P tech sector' },
      VOL,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'SQQQ',
    related: [
      { symbol: 'QQQ', role: 'index_proxy', note: 'unlevered Nasdaq-100 — SQQQ is −3x this' },
      { symbol: 'SMH', role: 'sector_etf', note: 'semis — QQQ/SQQQ heavyweight sector' },
      { symbol: 'XLK', role: 'sector_etf', note: 'S&P tech sector' },
      VOL,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'SOXL',
    related: [
      { symbol: 'SMH', role: 'sector_etf', note: 'unlevered semis — SOXL is +3x this' },
      { symbol: 'SOXS', role: 'peer', note: 'Direxion semis −3x — inverse peer' },
      { symbol: 'XLK', role: 'sector_etf', note: 'S&P tech sector' },
      VOL,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'UPRO',
    related: [
      { symbol: 'SPY', role: 'index_proxy', note: 'unlevered S&P 500 — UPRO is +3x this' },
      { symbol: 'XLF', role: 'sector_etf', note: 'financials — S&P heavyweight sector' },
      VOL,
      RATES,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'SPXU',
    related: [
      { symbol: 'SPY', role: 'index_proxy', note: 'unlevered S&P 500 — SPXU is −3x this' },
      { symbol: 'XLF', role: 'sector_etf', note: 'financials — S&P heavyweight sector' },
      VOL,
      RATES,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'WTI/USD',
    related: [
      { symbol: 'USO', role: 'peer', note: 'US Oil Fund — WTI futures ETF' },
      { symbol: 'XBR/USD', role: 'peer', note: 'Brent spot — co-moving crude' },
      { symbol: 'XLE', role: 'sector_etf', note: 'energy equities' },
      { symbol: 'XOP', role: 'sector_etf', note: 'oil & gas E&P equities' },
      DOLLAR,
      VOL,
    ],
    asiaLinks: ['zh'],
  },
  {
    instrument: 'XBR/USD',
    related: [
      { symbol: 'BNO', role: 'peer', note: 'US Brent Oil Fund — Brent futures ETF' },
      { symbol: 'WTI/USD', role: 'peer', note: 'WTI spot — co-moving crude' },
      { symbol: 'XLE', role: 'sector_etf', note: 'energy equities' },
      DOLLAR,
      VOL,
    ],
    asiaLinks: ['zh'],
  },
  {
    instrument: 'UNG',
    related: [
      { symbol: 'WTI/USD', role: 'peer', note: 'WTI spot — co-moving energy' },
      { symbol: 'BOIL', role: 'peer', note: '2x Bloomberg natgas — bullish sentiment proxy' },
      { symbol: 'KOLD', role: 'peer', note: '-2x Bloomberg natgas — bearish sentiment proxy' },
      { symbol: 'XLE', role: 'sector_etf', note: 'energy equities' },
      DOLLAR,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'CPER',
    related: [
      { symbol: 'COPX', role: 'sector_etf', note: 'Global X copper miners — China/Chile mine-equity beta' },
      { symbol: 'FCX', role: 'peer', note: 'Freeport-McMoRan — largest listed copper producer' },
      { symbol: 'XLB', role: 'sector_etf', note: 'materials sector' },
      DOLLAR,
      VOL,
    ],
    asiaLinks: ['zh'],
  },
  {
    instrument: 'CORN',
    related: [
      { symbol: 'WEAT', role: 'peer', note: 'Teucrium wheat — co-moving grain' },
      { symbol: 'SOYB', role: 'peer', note: 'Teucrium soybean — co-moving grain' },
      { symbol: 'DBA', role: 'commodity_proxy', note: 'Invesco DB Agriculture — broad ag basket' },
      DOLLAR,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'WEAT',
    related: [
      { symbol: 'CORN', role: 'peer', note: 'Teucrium corn — co-moving grain' },
      { symbol: 'SOYB', role: 'peer', note: 'Teucrium soybean — co-moving grain' },
      { symbol: 'DBA', role: 'commodity_proxy', note: 'Invesco DB Agriculture — broad ag basket' },
      DOLLAR,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'SOYB',
    related: [
      { symbol: 'CORN', role: 'peer', note: 'Teucrium corn — co-moving grain' },
      { symbol: 'WEAT', role: 'peer', note: 'Teucrium wheat — co-moving grain' },
      { symbol: 'DBA', role: 'commodity_proxy', note: 'Invesco DB Agriculture — broad ag basket' },
      DOLLAR,
    ],
    asiaLinks: ['zh'],
  },
  {
    instrument: 'COFF',
    related: [
      { symbol: 'DBA', role: 'commodity_proxy', note: 'Invesco DB Agriculture — coffee is a softs sleeve' },
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
      { symbol: 'ETH/USD', role: 'peer', note: 'major-alt benchmark' },
      { symbol: 'DOGE/USD', role: 'peer', note: 'co-moving memecoin' },
    ],
    asiaLinks: ['ko'],
  },
  {
    instrument: 'PEPE/USD',
    related: [
      { symbol: 'ETH/USD', role: 'peer', note: 'ERC-20 host-chain beta — PEPE follows ETH, not SOL' },
      { symbol: 'DOGE/USD', role: 'peer', note: 'meme-complex co-move' },
      VOL,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'WIF/USD',
    related: [
      { symbol: 'SOL/USD', role: 'peer', note: 'Solana host-chain beta — WIF is not BTC-only' },
      { symbol: 'BTC/USD', role: 'peer', note: 'crypto risk-on overlay' },
      { symbol: 'BONK/USD', role: 'peer', note: 'co-moving Solana memecoin' },
      VOL,
    ],
    asiaLinks: [],
  },
  {
    instrument: 'BONK/USD',
    related: [
      { symbol: 'SOL/USD', role: 'peer', note: 'Solana host-chain beta — BONK is not BTC-only' },
      { symbol: 'BTC/USD', role: 'peer', note: 'crypto risk-on overlay' },
      { symbol: 'WIF/USD', role: 'peer', note: 'co-moving Solana memecoin' },
      VOL,
    ],
    asiaLinks: [],
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
