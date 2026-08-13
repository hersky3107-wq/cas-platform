import 'server-only'

/**
 * AI Prediction League — market-data adapter (Twelve Data).
 *
 * Two jobs:
 *  1. fetchDataPacket(): current quote + recent N-day daily series for an
 *     instrument, normalized and formatted for injection into model prompts
 *     (tiers premier/challenger/world get ONLY this packet; scout uses web search).
 *  2. resolveActualOutcome(): the real resolved close + day-over-day direction,
 *     used by the reconciliation job's fetchActualOutcome.
 *
 * Key: process.env.TWELVE_DATA_API_KEY (add to .env.local; full restart after).
 *
 * FREE (Basic) TIER SCOPE: US equities, forex, crypto only. International
 * exchanges (e.g. KRX / Samsung 005930) require a paid Grow/Pro plan — the
 * symbol mapper still emits the correct exchange param, but a free key will get
 * a "not available on your plan" error back, in which case the packet is marked
 * unavailable and price-tier models see "no live data" (and may abstain).
 */

const TWELVE_DATA_BASE = 'https://api.twelvedata.com'
const DEFAULT_SERIES_DAYS = 10
const FETCH_TIMEOUT_MS = 15_000

export type InstrumentKind = 'stock' | 'crypto' | 'fx' | 'other'

export type MappedInstrument = {
  /** Twelve Data `symbol` param (e.g. 'AAPL', 'BTC/USD', 'EUR/USD', '005930'). */
  symbol: string
  /** Twelve Data `exchange` param when needed (e.g. 'KRX'). */
  exchange?: string
  kind: InstrumentKind
}

/**
 * Maps a ledger instrument string to Twelve Data params.
 *  - 'BTC-USD' / 'ETH-USDT' → crypto pair 'BTC/USD' (dash → slash)
 *  - 'EUR/USD'              → fx pair (slash kept)
 *  - '005930.KS' / '.KQ'    → symbol '005930', exchange 'KRX' (Korea)
 *  - 'AAPL'                 → US stock, as-is
 * Returns null for non-market instruments (e.g. 'MATCH:TOT-vs-ARS').
 */
export function mapInstrumentToTwelveData(instrument: string): MappedInstrument | null {
  const raw = instrument.trim()
  if (!raw || raw.includes(':')) return null // e.g. 'MATCH:...' sports handles are not price instruments

  if (raw.endsWith('.KS') || raw.endsWith('.KQ')) {
    return { symbol: raw.slice(0, -3), exchange: 'KRX', kind: 'stock' }
  }
  if (raw.includes('/')) {
    // Already a pair: FX (EUR/USD) or crypto (BTC/USD). Treat 3+3 fiat as fx, else crypto.
    const [base, quote] = raw.split('/')
    const fiat = new Set(['USD', 'EUR', 'JPY', 'KRW', 'GBP', 'CNY', 'AUD', 'CAD', 'CHF', 'HKD'])
    const kind: InstrumentKind = fiat.has(base?.toUpperCase()) && fiat.has(quote?.toUpperCase()) ? 'fx' : 'crypto'
    return { symbol: raw.toUpperCase(), kind }
  }
  if (raw.includes('-')) {
    // 'BTC-USD' → crypto pair.
    return { symbol: raw.replace('-', '/').toUpperCase(), kind: 'crypto' }
  }
  // Plain ticker → US stock (or ETF/index the free tier supports).
  return { symbol: raw.toUpperCase(), kind: 'stock' }
}

function getApiKey(): string | null {
  const k = process.env.TWELVE_DATA_API_KEY
  return k && k.trim().length ? k.trim() : null
}

async function twelveDataGet(path: string, params: Record<string, string>): Promise<{ ok: true; json: any } | { ok: false; error: string }> {
  const apiKey = getApiKey()
  if (!apiKey) return { ok: false, error: 'TWELVE_DATA_API_KEY not set' }

  const qs = new URLSearchParams({ ...params, apikey: apiKey }).toString()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${TWELVE_DATA_BASE}/${path}?${qs}`, { signal: controller.signal })
    const body = await res.text().catch(() => '')
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}${body ? ` - ${body.slice(0, 300)}` : ''}` }
    let json: any
    try {
      json = JSON.parse(body)
    } catch {
      return { ok: false, error: `Non-JSON response: ${body.slice(0, 300)}` }
    }
    // Twelve Data signals errors in-body (often with HTTP 200): { status:'error', code, message }.
    if (json?.status === 'error') {
      return { ok: false, error: `TwelveData error${json?.code ? ` ${json.code}` : ''}: ${json?.message ?? 'unknown'}` }
    }
    return { ok: true, json }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown fetch error'
    return { ok: false, error: msg.toLowerCase().includes('abort') ? `timeout after ${FETCH_TIMEOUT_MS}ms` : msg }
  } finally {
    clearTimeout(timer)
  }
}

export type DataPacket = {
  available: boolean
  instrument: string
  symbol?: string
  currency?: string
  asOf?: string
  latestClose?: number
  previousClose?: number
  percentChange?: number
  /** Oldest→newest daily closes. */
  series?: { date: string; close: number }[]
  error?: string
}

function num(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Current quote + recent daily series for an instrument (one packet, injected
 * to every price-tier model — so it costs 2 Twelve Data credits per ROUND, not
 * per model). Never throws; returns { available:false, error } on any problem.
 */
export async function fetchDataPacket(instrument: string, days = DEFAULT_SERIES_DAYS): Promise<DataPacket> {
  const mapped = mapInstrumentToTwelveData(instrument)
  if (!mapped) return { available: false, instrument, error: 'instrument is not a market price symbol' }

  const base: Record<string, string> = { symbol: mapped.symbol }
  if (mapped.exchange) base.exchange = mapped.exchange

  const [quoteRes, seriesRes] = await Promise.all([
    twelveDataGet('quote', base),
    twelveDataGet('time_series', { ...base, interval: '1day', outputsize: String(days) }),
  ])

  if (!quoteRes.ok && !seriesRes.ok) {
    return { available: false, instrument, symbol: mapped.symbol, error: quoteRes.error }
  }

  const q = quoteRes.ok ? quoteRes.json : {}
  const values: any[] = seriesRes.ok && Array.isArray(seriesRes.json?.values) ? seriesRes.json.values : []
  // Twelve Data returns values newest-first; flip to oldest→newest for readability.
  const series = values
    .map((v) => ({ date: String(v?.datetime ?? ''), close: num(v?.close) }))
    .filter((v): v is { date: string; close: number } => typeof v.close === 'number' && !!v.date)
    .reverse()

  const latestClose = num(q?.close) ?? series[series.length - 1]?.close
  const previousClose = num(q?.previous_close) ?? (series.length >= 2 ? series[series.length - 2].close : undefined)
  const percentChange = num(q?.percent_change)

  return {
    available: typeof latestClose === 'number',
    instrument,
    symbol: mapped.symbol,
    currency: typeof q?.currency === 'string' ? q.currency : seriesRes.ok ? seriesRes.json?.meta?.currency : undefined,
    asOf: typeof q?.datetime === 'string' ? q.datetime : series[series.length - 1]?.date,
    latestClose,
    previousClose,
    percentChange,
    series,
    error: typeof latestClose === 'number' ? undefined : 'no usable price data returned',
  }
}

/** Compact text block for prompt injection. Assumes packet.available. */
export function formatDataPacketForPrompt(packet: DataPacket): string {
  const lines: string[] = []
  lines.push(`Symbol: ${packet.symbol}${packet.currency ? ` (${packet.currency})` : ''}`)
  if (typeof packet.latestClose === 'number') lines.push(`Latest close: ${packet.latestClose}${packet.asOf ? ` (as of ${packet.asOf})` : ''}`)
  if (typeof packet.previousClose === 'number') lines.push(`Previous close: ${packet.previousClose}`)
  if (typeof packet.percentChange === 'number') lines.push(`Last change: ${packet.percentChange}%`)
  if (packet.series && packet.series.length) {
    const rows = packet.series.map((s) => `  ${s.date}: ${s.close}`).join('\n')
    lines.push(`Recent daily closes (oldest→newest):\n${rows}`)
  }
  return lines.join('\n')
}

export type ResolvedOutcome = {
  rawOutcome: string
  actualDirection: 'up' | 'down' | 'flat' | null
}

/** Small deadband so a ~0% move resolves 'flat' rather than a noisy up/down. */
const FLAT_THRESHOLD_PCT = 0.1

/**
 * Real resolved close + day-over-day direction for reconciliation. Uses /quote
 * (latest close + previous_close + percent_change).
 *
 * NOTE: direction here is close-vs-previous-close (session over session), which
 * matches "closes higher than its last close" style props. Resolving strictly
 * against the price snapshot at round-open would need an anchor-price column on
 * prediction_rounds — a // v2 refinement.
 */
export async function resolveActualOutcome(instrument: string): Promise<ResolvedOutcome | null> {
  const mapped = mapInstrumentToTwelveData(instrument)
  if (!mapped) return null

  const params: Record<string, string> = { symbol: mapped.symbol }
  if (mapped.exchange) params.exchange = mapped.exchange

  const res = await twelveDataGet('quote', params)
  if (!res.ok) return null

  const q = res.json
  const close = num(q?.close)
  if (typeof close !== 'number') return null

  const pct = num(q?.percent_change)
  const change = num(q?.change)
  let direction: 'up' | 'down' | 'flat' | null = null
  const basis = typeof pct === 'number' ? pct : typeof change === 'number' ? change : undefined
  if (typeof basis === 'number') {
    if (typeof pct === 'number' && Math.abs(pct) < FLAT_THRESHOLD_PCT) direction = 'flat'
    else direction = basis > 0 ? 'up' : basis < 0 ? 'down' : 'flat'
  }

  const rawOutcome = `close=${close}${q?.currency ? ` ${q.currency}` : ''}${q?.datetime ? ` @ ${q.datetime}` : ''}${typeof pct === 'number' ? ` (${pct}%)` : ''}`
  return { rawOutcome, actualDirection: direction }
}
