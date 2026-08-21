import 'server-only'

import {
  addUtcDays,
  normalizeSessionDate,
  precheckResolutionWindow,
  resolveRoundOutcome,
  toUtcDate,
  type DailyBar,
  type ResolutionResult,
  type RoundResolutionInput,
  type SeriesResult,
} from '@/lib/prediction/resolution'

/**
 * AI Prediction League — market-data adapter (Twelve Data).
 *
 * Two jobs:
 *  1. fetchDataPacket(): current quote + recent N-day daily series for an
 *     instrument, normalized and formatted for injection into model prompts
 *     (tiers premier/challenger/world get ONLY this packet; scout uses web search).
 *  2. resolveActualOutcome(): GRADING. Takes the ROUND (its persisted
 *     `anchor_price` baseline + `resolves_at` deadline) and resolves it against
 *     the HISTORICAL daily close inside that window — `time_series` only, never
 *     `/quote`, never a live price. Used by the reconciliation job's
 *     fetchActualOutcome. The decision logic itself is pure and lives in
 *     `lib/prediction/resolution.ts`.
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

/**
 * Session date of a persisted close, taken from the packet's dated bars —
 * never from `asOf` / wall-clock. Null when no bar matches.
 */
export function sessionDateForPrice(packet: DataPacket, price: number): string | null {
  const series = packet.series ?? []
  for (let i = series.length - 1; i >= 0; i--) {
    const bar = series[i]
    if (Math.abs(bar.close - price) < 0.005) return normalizeSessionDate(bar.date)
  }
  return null
}

/**
 * Lightweight CURRENT quote — the `/quote` endpoint only (1 Twelve Data
 * credit), no time series. Used by `live-price-cache.ts` for the card
 * header's optional "live" price, which needs freshness far more than it
 * needs the 10-day series `fetchDataPacket` also fetches for model prompts.
 * Never throws; callers get `null` on any problem (bad symbol, no key,
 * rate limit, timeout, malformed response).
 */
export async function fetchLiveQuote(instrument: string): Promise<{ price: number; asOf: string } | null> {
  const mapped = mapInstrumentToTwelveData(instrument)
  if (!mapped) return null

  const params: Record<string, string> = { symbol: mapped.symbol }
  if (mapped.exchange) params.exchange = mapped.exchange

  const res = await twelveDataGet('quote', params)
  if (!res.ok) return null

  const price = num(res.json?.close)
  if (typeof price !== 'number') return null
  const asOf = typeof res.json?.datetime === 'string' ? res.json.datetime : new Date().toISOString()
  return { price, asOf }
}

/**
 * HISTORICAL daily closes for an inclusive UTC date range, from `time_series`.
 * This is the ONLY price call in the grading path: no `/quote`, so a round
 * reconciled days late is still graded against the close that actually
 * happened inside its own window.
 */
export async function fetchDailyCloses(
  instrument: string,
  startDate: string,
  endDate: string
): Promise<SeriesResult> {
  const mapped = mapInstrumentToTwelveData(instrument)
  if (!mapped) return { ok: false, error: `instrument ${instrument} is not a market price symbol` }

  const params: Record<string, string> = {
    symbol: mapped.symbol,
    interval: '1day',
    start_date: startDate,
    end_date: endDate,
    // Windows are short (24h…1m horizons); this only guards against the
    // provider's default page size clipping a longer window.
    outputsize: '500',
  }
  if (mapped.exchange) params.exchange = mapped.exchange

  const res = await twelveDataGet('time_series', params)
  if (!res.ok) return { ok: false, error: res.error }

  const values: any[] = Array.isArray(res.json?.values) ? res.json.values : []
  const bars: DailyBar[] = values
    .map((v) => ({ sessionDate: normalizeSessionDate(v?.datetime), close: num(v?.close) }))
    .filter((v): v is DailyBar => typeof v.sessionDate === 'string' && typeof v.close === 'number')
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))

  return { ok: true, bars }
}

/**
 * GRADING ENTRY POINT. Resolves ONE round against its own persisted baseline
 * and its own deadline:
 *   baseline   = round.anchorPrice (observed at round.anchorPriceAt)
 *   resolution = close of the last session inside (anchorPriceAt, resolvesAt]
 *
 * Returns a REASON rather than a direction whenever the round cannot be graded
 * honestly (no anchor, no session in the window, feed failure, exact tie) — see
 * `lib/prediction/resolution.ts`. There is no live-quote fallback and no
 * re-derived baseline: a round we cannot grade correctly stays ungraded.
 */
export async function resolveActualOutcome(round: RoundResolutionInput): Promise<ResolutionResult> {
  if (!mapInstrumentToTwelveData(round.instrument)) {
    return { ok: false, reason: 'not_price_instrument', detail: `${round.instrument} has no price symbol mapping` }
  }

  // Validate the baseline/window BEFORE spending a price-feed credit.
  const precheck = precheckResolutionWindow(round)
  if (precheck) return precheck

  const anchorDate = toUtcDate(Date.parse(round.anchorPriceAt!))
  // +1 UTC day of headroom so the deadline day's bar is always in the response;
  // bars past the deadline are then discarded by the window rule itself.
  const endDate = addUtcDays(toUtcDate(Date.parse(round.resolvesAt)), 1)

  const series = await fetchDailyCloses(round.instrument, anchorDate, endDate)
  return resolveRoundOutcome({ ...round, series })
}
