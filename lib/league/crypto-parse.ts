/**
 * Pure crypto-major packet helpers. No fetches — unit tests never import
 * `server-only`. Per-chip isolation: BTC gets on-chain + dominance + IBIT/FBTC;
 * ETH gets ETH dominance + ETHA; SOL/XRP/BNB get Binance positioning + beta
 * via relations. Deribit IV is BTC/ETH/SOL only (XRP/BNB have no options).
 */

export type CryptoMajorFamily = 'btc' | 'eth' | 'sol' | 'xrp' | 'bnb'

export type CryptoMajorFieldPlan = {
  family: CryptoMajorFamily
  binanceSymbol: string
  fearGreed: true
  funding: true
  openInterest: true
  topTraderLs: true
  takerRatio: true
  deribitIv: boolean
  onChainBtc: boolean
  btcDominance: boolean
  ethDominance: boolean
  etfTickers: readonly string[]
  farsideEth: boolean
}

function instrumentKey(instrument?: string): string {
  return instrument?.trim().toUpperCase().replace(/-/g, '/') ?? ''
}

function baseOf(instrument?: string): string | null {
  const raw = instrumentKey(instrument)
  if (!raw) return null
  if (raw.includes('/')) return raw.split('/')[0] ?? null
  return raw
}

export function classifyCryptoMajorInstrument(instrument?: string): CryptoMajorFamily | null {
  switch (baseOf(instrument)) {
    case 'BTC':
      return 'btc'
    case 'ETH':
      return 'eth'
    case 'SOL':
      return 'sol'
    case 'XRP':
      return 'xrp'
    case 'BNB':
      return 'bnb'
    default:
      return null
  }
}

export function cryptoMajorFieldPlan(instrument?: string): CryptoMajorFieldPlan | null {
  const family = classifyCryptoMajorInstrument(instrument)
  if (!family) return null
  const binanceSymbol =
    family === 'btc'
      ? 'BTCUSDT'
      : family === 'eth'
        ? 'ETHUSDT'
        : family === 'sol'
          ? 'SOLUSDT'
          : family === 'xrp'
            ? 'XRPUSDT'
            : 'BNBUSDT'
  return {
    family,
    binanceSymbol,
    fearGreed: true,
    funding: true,
    openInterest: true,
    topTraderLs: true,
    takerRatio: true,
    deribitIv: family === 'btc' || family === 'eth' || family === 'sol',
    onChainBtc: family === 'btc',
    btcDominance: family === 'btc',
    ethDominance: family === 'eth',
    etfTickers: family === 'btc' ? ['IBIT', 'FBTC'] : family === 'eth' ? ['ETHA'] : [],
    farsideEth: family === 'eth',
  }
}

/** FINRA CNMS tickers for the spot-ETF short-volume proxy (BTC/ETH only). */
export function cryptoSpotEtfTickers(instrument?: string): readonly string[] {
  return cryptoMajorFieldPlan(instrument)?.etfTickers ?? []
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export type BlockchainChartPoint = { date: string; value: number; unit?: string }

/** blockchain.info `/charts/{name}?format=json` — `values[].x` is unix seconds. */
export function parseBlockchainChart(
  json: unknown,
  label: string,
): BlockchainChartPoint | { unavailable: string } {
  const values = (json as { values?: unknown })?.values
  if (!Array.isArray(values) || values.length === 0) {
    return { unavailable: `${label}: empty values[]` }
  }
  const last = values[values.length - 1] as { x?: unknown; y?: unknown }
  const y = num(last?.y)
  if (y == null) return { unavailable: `${label}: no numeric y` }
  const x = num(last?.x)
  const unit = String((json as { unit?: unknown })?.unit ?? '').trim() || undefined
  return {
    date: x != null ? new Date(x * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    value: y,
    unit,
  }
}

export type DifficultyAdjustment = {
  progressPct: number
  changePct: number
  estimatedDate: string | null
  remainingBlocks: number | null
}

/** mempool.space `/api/v1/difficulty-adjustment`. */
export function parseMempoolDifficulty(json: unknown): DifficultyAdjustment | { unavailable: string } {
  const row = json && typeof json === 'object' ? (json as Record<string, unknown>) : null
  if (!row) return { unavailable: 'mempool.space difficulty-adjustment: empty' }
  const progressPct = num(row.progressPercent)
  const changePct = num(row.difficultyChange)
  if (progressPct == null && changePct == null) {
    return { unavailable: 'mempool.space difficulty-adjustment: no progress/change' }
  }
  const retarget = num(row.estimatedRetargetDate)
  const remaining = num(row.remainingBlocks)
  return {
    progressPct: progressPct ?? 0,
    changePct: changePct ?? 0,
    estimatedDate: retarget != null ? new Date(retarget).toISOString() : null,
    remainingBlocks: remaining,
  }
}

export type MempoolFees = {
  fastest: number
  halfHour: number
  hour: number
  economy: number
  unit: 'sat/vB'
}

/** mempool.space `/api/v1/fees/recommended`. */
export function parseMempoolFees(json: unknown): MempoolFees | { unavailable: string } {
  const row = json && typeof json === 'object' ? (json as Record<string, unknown>) : null
  if (!row) return { unavailable: 'mempool.space fees: empty' }
  const fastest = num(row.fastestFee)
  const halfHour = num(row.halfHourFee)
  const hour = num(row.hourFee)
  const economy = num(row.economyFee)
  if (fastest == null && halfHour == null && hour == null) {
    return { unavailable: 'mempool.space fees: no fee fields' }
  }
  return {
    fastest: fastest ?? 0,
    halfHour: halfHour ?? 0,
    hour: hour ?? 0,
    economy: economy ?? 0,
    unit: 'sat/vB',
  }
}

export type DominancePoint = { date: string; btcPct: number | null; ethPct: number | null }

/** CoinGecko `/api/v3/global` — market_cap_percentage.btc / .eth. */
export function parseCoinGeckoGlobal(json: unknown): DominancePoint | { unavailable: string } {
  const data = (json as { data?: { market_cap_percentage?: Record<string, unknown>; updated_at?: unknown } })?.data
  const caps = data?.market_cap_percentage
  if (!caps || typeof caps !== 'object') return { unavailable: 'CoinGecko /global: no market_cap_percentage' }
  const btcPct = num(caps.btc)
  const ethPct = num(caps.eth)
  if (btcPct == null && ethPct == null) return { unavailable: 'CoinGecko /global: no btc/eth dominance' }
  const updated = num(data?.updated_at)
  return {
    date: updated != null ? new Date(updated * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    btcPct,
    ethPct,
  }
}
