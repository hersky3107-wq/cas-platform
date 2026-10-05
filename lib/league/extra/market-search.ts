/**
 * One public search per venue for the consensus extra seat.
 * HTTP 451, 403, timeout, or any other failure is provider_unavailable:
 * that venue is skipped. No proxy and no second route.
 */
import { POLYMARKET_GAMMA_ORIGIN } from '../politics/markets'
import type { MarketVenue, OpenMarketCandidate } from './market-match'

export const KALSHI_PUBLIC_SEARCH = 'https://api.elections.kalshi.com/v1/search/series'
export const MARKET_SEARCH_TIMEOUT_MS = 8_000
const PER_VENUE_CAP = 12

export type ProviderUnavailableLog = (event: {
  event: 'provider_unavailable'
  provider: MarketVenue
  status: string
}) => void

type SearchOpts = {
  fetchImpl?: typeof fetch
  log?: ProviderUnavailableLog
  timeoutMs?: number
}

export function kalshiSearchUrl(query: string): string {
  const q = new URLSearchParams({
    query,
    order_by: 'querymatch',
    page_size: '5',
    fuzzy_threshold: '4',
  })
  return `${KALSHI_PUBLIC_SEARCH}?${q.toString()}`
}

export function polymarketSearchUrl(query: string): string {
  const q = new URLSearchParams({ q: query, limit_per_type: '5' })
  return `${POLYMARKET_GAMMA_ORIGIN}/public-search?${q.toString()}`
}

export async function searchConsensusMarkets(query: string, opts: SearchOpts = {}): Promise<OpenMarketCandidate[]> {
  const [kalshi, polymarket] = await Promise.all([
    searchVenue('kalshi', kalshiSearchUrl(query), opts),
    searchVenue('polymarket', polymarketSearchUrl(query), opts),
  ])
  return [...kalshi, ...polymarket]
}

async function searchVenue(venue: MarketVenue, url: string, opts: SearchOpts): Promise<OpenMarketCandidate[]> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? MARKET_SEARCH_TIMEOUT_MS
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    })
    if (res.status === 451 || res.status === 403 || !res.ok) {
      emit(opts.log, venue, String(res.status))
      return []
    }
    const body = (await res.json()) as unknown
    return venue === 'kalshi' ? parseKalshiSearch(body) : parsePolymarketSearch(body)
  } catch (e: unknown) {
    emit(opts.log, venue, isTimeout(e) ? 'timeout' : 'error')
    return []
  } finally {
    clearTimeout(timer)
  }
}

function emit(log: ProviderUnavailableLog | undefined, provider: MarketVenue, status: string): void {
  const event = { event: 'provider_unavailable' as const, provider, status }
  if (log) log(event)
  else console.info(JSON.stringify(event))
}

function isTimeout(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const name = 'name' in e ? String((e as { name?: string }).name) : ''
  return name === 'AbortError' || name === 'TimeoutError'
}

export function parseKalshiSearch(body: unknown): OpenMarketCandidate[] {
  const page = (body as { current_page?: unknown } | null)?.current_page
  const events = (body as { events?: unknown } | null)?.events
  const rows = Array.isArray(page) ? page : Array.isArray(events) ? events : []
  const out: OpenMarketCandidate[] = []
  for (const event of rows) {
    if (!event || typeof event !== 'object') continue
    const markets = (event as { markets?: unknown }).markets
    if (!Array.isArray(markets)) continue
    const eventTitle = str((event as { event_title?: unknown }).event_title)
    for (const market of markets) {
      if (!market || typeof market !== 'object') continue
      const row = market as Record<string, unknown>
      if (str(row.result)) continue
      const id = str(row.ticker) || str(row.market_id)
      if (!id) continue
      const implied = yesFromDollars(row.yes_bid_dollars, row.yes_ask_dollars, row.last_price_dollars)
      if (implied == null) continue
      out.push({
        venue: 'kalshi',
        id,
        title: str(row.title) || eventTitle || id,
        outcome: str(row.yes_subtitle) || str(row.title) || id,
        impliedYes: implied,
        resolvesAt: str(row.close_ts) || str(row.expected_expiration_ts) || null,
      })
      if (out.length >= PER_VENUE_CAP) return out
    }
  }
  return out
}

export function parsePolymarketSearch(body: unknown): OpenMarketCandidate[] {
  const events = Array.isArray(body)
    ? body
    : Array.isArray((body as { events?: unknown } | null)?.events)
      ? (body as { events: unknown[] }).events
      : []
  const out: OpenMarketCandidate[] = []
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const ev = event as Record<string, unknown>
    if (ev.closed === true) continue
    const markets = Array.isArray(ev.markets) ? ev.markets : []
    for (const market of markets) {
      if (!market || typeof market !== 'object') continue
      const row = market as Record<string, unknown>
      if (row.closed === true) continue
      const id = str(row.slug) || str(row.conditionId) || str(row.id)
      if (!id) continue
      const implied = polymarketYes(row)
      if (implied == null) continue
      out.push({
        venue: 'polymarket',
        id,
        title: str(row.question) || str(ev.title) || id,
        outcome: str(row.groupItemTitle) || yesOutcomeLabel(row) || str(row.question) || id,
        impliedYes: implied,
        resolvesAt: str(row.endDate) || str(ev.endDate) || null,
      })
      if (out.length >= PER_VENUE_CAP) return out
    }
  }
  return out
}

function yesFromDollars(bidRaw: unknown, askRaw: unknown, lastRaw: unknown): number | null {
  const bid = num(bidRaw)
  const ask = num(askRaw)
  const last = num(lastRaw)
  if (bid != null && ask != null && ask >= bid && bid >= 0 && ask <= 1 && ask - bid <= 0.25) {
    return round4((ask + bid) / 2)
  }
  if (last != null && last >= 0 && last <= 1) return round4(last)
  if (bid != null && ask != null && ask >= bid && bid >= 0 && ask <= 1) return round4((ask + bid) / 2)
  return null
}

function polymarketYes(market: Record<string, unknown>): number | null {
  const outcomes = asList(market.outcomes)
  const prices = asList(market.outcomePrices).map(Number)
  const yesAt = outcomes.findIndex((o) => /^yes$/i.test(o.trim()))
  const idx = yesAt >= 0 ? yesAt : 0
  const p = prices[idx]
  if (!Number.isFinite(p) || p < 0 || p > 1) return null
  return round4(p)
}

function yesOutcomeLabel(market: Record<string, unknown>): string | null {
  const outcomes = asList(market.outcomes)
  const yes = outcomes.find((o) => /^yes$/i.test(o.trim()))
  return yes ?? outcomes[0] ?? null
}

function asList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function str(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function num(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return Number.isFinite(n) ? n : null
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
