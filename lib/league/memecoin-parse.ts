/**
 * Pure memecoin packet helpers. No fetches — unit tests never import
 * `server-only`. Binance USDT-M perpetuals: SHIB/PEPE/BONK are 1000x
 * contracts (1000SHIBUSDT), not SHIBUSDT. Fear & Greed is market-wide.
 */

export type MemecoinFamily = 'doge' | 'shib' | 'pepe' | 'wif' | 'bonk'

export type MemecoinHostMajor = 'BTC/USD' | 'ETH/USD' | 'SOL/USD'

/**
 * Binance USDT-M perpetual symbol. 1000x-multiplier contracts MUST be
 * explicit — the naive `${base}USDT` mapping 404s on SHIB/PEPE/BONK.
 */
export const BINANCE_PERP_BY_BASE: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
  BNB: 'BNBUSDT',
  ADA: 'ADAUSDT',
  DOGE: 'DOGEUSDT',
  SHIB: '1000SHIBUSDT',
  PEPE: '1000PEPEUSDT',
  WIF: 'WIFUSDT',
  BONK: '1000BONKUSDT',
}

export type MemecoinFieldPlan = {
  family: MemecoinFamily
  binanceSymbol: string
  fearGreed: true
  funding: true
  openInterest: true
  topTraderLs: true
  takerRatio: true
  /** Host-chain / major beta printed via relations — isolation, not extra fetches. */
  hostMajors: readonly MemecoinHostMajor[]
}

export type FearGreedPoint = {
  date: string
  value: number
  classification: string
}

export type FearGreedSnapshot = {
  latest: FearGreedPoint
  week: readonly FearGreedPoint[]
}

export type BinanceRatioSnapshot = {
  symbol: string
  timestamp: string
  period: string
  longAccountPct?: number
  shortAccountPct?: number
  longShortRatio?: number
  buySellRatio?: number
  buyVol?: number
  sellVol?: number
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

export function classifyMemecoinInstrument(instrument?: string): MemecoinFamily | null {
  switch (baseOf(instrument)) {
    case 'DOGE':
      return 'doge'
    case 'SHIB':
      return 'shib'
    case 'PEPE':
      return 'pepe'
    case 'WIF':
      return 'wif'
    case 'BONK':
      return 'bonk'
    default:
      return null
  }
}

/**
 * Maps a catalog pair (or BTC/ETH/SOL) onto Binance USDT-M perpetuals.
 * Returns null when there is no quote or the base is empty.
 */
export function binancePerpSymbol(instrument?: string): string | null {
  const raw = instrumentKey(instrument)
  if (!raw) return null
  if (BINANCE_PERP_BY_BASE[raw]) return BINANCE_PERP_BY_BASE[raw]
  const [base, quote] = raw.includes('/') ? raw.split('/') : [raw, 'USDT']
  if (!base) return null
  if (quote && quote !== 'USD' && quote !== 'USDT') return null
  if (BINANCE_PERP_BY_BASE[base]) return BINANCE_PERP_BY_BASE[base]
  if (/^[A-Z0-9]{2,12}$/.test(base)) return `${base}USDT`
  return null
}

/** Per-chip isolation: PEPE → ETH; WIF/BONK → SOL (+ BTC overlay); DOGE/SHIB → BTC/ETH. */
export function memecoinFieldPlan(instrument?: string): MemecoinFieldPlan | null {
  const family = classifyMemecoinInstrument(instrument)
  if (!family) return null
  const symbol = binancePerpSymbol(instrument)
  if (!symbol) return null
  const hostMajors: readonly MemecoinHostMajor[] =
    family === 'pepe'
      ? ['ETH/USD']
      : family === 'wif' || family === 'bonk'
        ? ['SOL/USD', 'BTC/USD']
        : ['BTC/USD', 'ETH/USD']
  return {
    family,
    binanceSymbol: symbol,
    fearGreed: true,
    funding: true,
    openInterest: true,
    topTraderLs: true,
    takerRatio: true,
    hostMajors,
  }
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pctFromRatio(v: unknown): number | undefined {
  const n = num(v)
  if (n == null) return undefined
  return Number((n * 100).toFixed(4))
}

function utcDateFromUnixSec(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10)
}

function utcFromMs(ms: number): string {
  return new Date(ms).toISOString()
}

/**
 * Alternative.me `/fng/?limit=7` payload.
 * `{ data: [{ value, value_classification, timestamp }] }` — timestamp is unix seconds.
 */
export function parseFearGreedJson(json: unknown): FearGreedSnapshot | { unavailable: string } {
  const data = (json as { data?: unknown })?.data
  if (!Array.isArray(data) || data.length === 0) {
    return { unavailable: 'Alternative.me /fng: empty data[]' }
  }
  const week: FearGreedPoint[] = []
  for (const row of data) {
    const value = num((row as { value?: unknown })?.value)
    const ts = num((row as { timestamp?: unknown })?.timestamp)
    const classification = String((row as { value_classification?: unknown })?.value_classification ?? '').trim()
    if (value == null || ts == null) continue
    week.push({
      date: utcDateFromUnixSec(ts),
      value,
      classification: classification || 'unknown',
    })
  }
  if (!week.length) return { unavailable: 'Alternative.me /fng: no parseable points' }
  return { latest: week[0]!, week }
}

function firstRow(json: unknown): Record<string, unknown> | null {
  if (Array.isArray(json) && json[0] && typeof json[0] === 'object') return json[0] as Record<string, unknown>
  if (json && typeof json === 'object' && !Array.isArray(json)) return json as Record<string, unknown>
  return null
}

export function parseTopTraderLs(
  json: unknown,
  symbol: string,
  period: string,
): BinanceRatioSnapshot | { unavailable: string } {
  const row = firstRow(json)
  if (!row) return { unavailable: `Binance topLongShortPositionRatio: empty (${symbol})` }
  const longShortRatio = num(row.longShortRatio)
  const longAccount = num(row.longAccount)
  const shortAccount = num(row.shortAccount)
  const ts = num(row.timestamp)
  if (longShortRatio == null && longAccount == null) {
    return { unavailable: `Binance topLongShortPositionRatio: no ratio fields (${symbol})` }
  }
  return {
    symbol,
    timestamp: ts != null ? utcFromMs(ts) : new Date().toISOString(),
    period,
    longAccountPct: pctFromRatio(row.longAccount),
    shortAccountPct: pctFromRatio(row.shortAccount),
    longShortRatio: longShortRatio ?? undefined,
  }
}

export function parseTakerRatio(
  json: unknown,
  symbol: string,
  period: string,
): BinanceRatioSnapshot | { unavailable: string } {
  const row = firstRow(json)
  if (!row) return { unavailable: `Binance takerlongshortRatio: empty (${symbol})` }
  const buySellRatio = num(row.buySellRatio)
  const buyVol = num(row.buyVol)
  const sellVol = num(row.sellVol)
  const ts = num(row.timestamp)
  if (buySellRatio == null && buyVol == null) {
    return { unavailable: `Binance takerlongshortRatio: no ratio fields (${symbol})` }
  }
  return {
    symbol,
    timestamp: ts != null ? utcFromMs(ts) : new Date().toISOString(),
    period,
    buySellRatio: buySellRatio ?? undefined,
    buyVol: buyVol ?? undefined,
    sellVol: sellVol ?? undefined,
  }
}
