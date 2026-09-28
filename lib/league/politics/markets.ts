/**
 * Prediction-market slate for politics.
 * Kalshi public trade API (no auth) and Polymarket Gamma (no auth).
 * Gamma is fetched with a browser User-Agent and retries — Cloudflare 1026
 * is an edge block on bare clients, not a dead API.
 */

export const POLITICS_WINDOW_MS = 92 * 86_400_000
export const POLYMARKET_GAMMA_ORIGIN = 'https://gamma-api.polymarket.com'
export const KALSHI_TRADE_ORIGIN = 'https://external-api.kalshi.com/trade-api/v2'

export type PoliticsOffice = 'president' | 'senate' | 'house' | 'governor' | 'mayor' | 'other'

export type ElectionCandidateLite = {
  jurisdiction: string
  office: PoliticsOffice
  cycle: string
  district: string
  candidate: string
  pollCloseIso: string
  kalshiPct: number | null
  polymarketPct: number | null
}

const POLY_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
}

export function usGeneralElectionIso(year: number): string | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null
  const nov1 = new Date(Date.UTC(year, 10, 1))
  const dow = nov1.getUTCDay()
  const firstMonday = 1 + ((8 - dow) % 7)
  const electionDay = firstMonday + 1
  return `${year}-11-${String(electionDay).padStart(2, '0')}T23:00:00.000Z`
}

export function inPoliticsWindow(iso: string, now: Date): boolean {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return false
  const nowMs = now.getTime()
  return t > nowMs - 6 * 60 * 60 * 1000 && t <= nowMs + POLITICS_WINDOW_MS
}

function dollarsToPct(bid: unknown, ask: unknown, last: unknown): number | null {
  const b = typeof bid === 'string' ? Number(bid) : typeof bid === 'number' ? bid : NaN
  const a = typeof ask === 'string' ? Number(ask) : typeof ask === 'number' ? ask : NaN
  const l = typeof last === 'string' ? Number(last) : typeof last === 'number' ? last : NaN
  let p = NaN
  if (Number.isFinite(b) && Number.isFinite(a) && a >= b && b >= 0 && a <= 1) p = (a + b) / 2
  else if (Number.isFinite(l) && l >= 0 && l <= 1) p = l
  else if (Number.isFinite(b) && b >= 0 && b <= 1) p = b
  if (!Number.isFinite(p)) return null
  return Math.round(p * 1000) / 10
}

type KalshiMarket = {
  title?: string
  yes_sub_title?: string
  close_time?: string
  expected_expiration_time?: string
  occurrence_datetime?: string
  yes_bid_dollars?: string
  yes_ask_dollars?: string
  last_price_dollars?: string
  status?: string
}

type KalshiEvent = {
  title?: string
  event_ticker?: string
  series_ticker?: string
  category?: string
  sub_title?: string
  markets?: KalshiMarket[]
}

function cycleYearFromTicker(ticker: string): number | null {
  const m = ticker.match(/(?:^|-)(\d{2})(?:$|[^0-9])/)
  if (!m) return null
  const yy = Number(m[1])
  if (!Number.isFinite(yy)) return null
  return 2000 + yy
}

function officeFromTicker(ticker: string): { office: PoliticsOffice; district: string } | null {
  const senate = ticker.match(/(?:^|\b)(?:KX)?SENATE(?:PARTY)?([A-Z]{2})\b/i)
  if (senate) return { office: 'senate', district: senate[1]!.toUpperCase() }
  const house = ticker.match(/(?:^|\b)(?:KX)?HOUSE(?:PARTY)?([A-Z]{2})(\d+)\b/i)
  if (house) return { office: 'house', district: `${house[1]!.toUpperCase()}-${parseInt(house[2]!, 10)}` }
  const gov = ticker.match(/(?:^|\b)(?:KX)?GOV(?:ERNOR)?(?:PARTY)?([A-Z]{2})\b/i)
  if (gov) return { office: 'governor', district: gov[1]!.toUpperCase() }
  if (/(?:^|\b)(?:KX)?(?:PRES|PRESIDENT)\b/i.test(ticker)) return { office: 'president', district: '_' }
  if (/(?:^|\b)(?:KX)?MAYOR\b/i.test(ticker)) return { office: 'mayor', district: '_' }
  return null
}

function pollCloseForKalshi(event: KalshiEvent, market: KalshiMarket, now: Date): string | null {
  const ticker = `${event.series_ticker ?? ''} ${event.event_ticker ?? ''}`
  const office = officeFromTicker(ticker)
  const year = cycleYearFromTicker(event.event_ticker ?? event.series_ticker ?? '')
  const special = /special/i.test(ticker)
  if (office && year && !special && (office.office === 'senate' || office.office === 'house' || office.office === 'governor' || office.office === 'president')) {
    const general = usGeneralElectionIso(year)
    if (general && inPoliticsWindow(general, now)) return general
  }
  for (const iso of [market.occurrence_datetime, market.expected_expiration_time, market.close_time]) {
    if (iso && inPoliticsWindow(iso, now)) return new Date(Date.parse(iso)).toISOString()
  }
  return null
}

export function parseKalshiElectionEvents(payload: unknown, now: Date): ElectionCandidateLite[] {
  const events = (payload as { events?: KalshiEvent[] } | null)?.events
  if (!Array.isArray(events)) return []
  const out: ElectionCandidateLite[] = []
  for (const event of events) {
    const cat = (event.category ?? '').toLowerCase()
    if (cat && cat !== 'elections' && cat !== 'politics') continue
    const ticker = `${event.series_ticker ?? ''} ${event.event_ticker ?? ''}`
    const office = officeFromTicker(ticker)
    if (!office) continue
    const year = cycleYearFromTicker(event.event_ticker ?? event.series_ticker ?? '')
    const cycle = year ? String(year) : ''
    if (!cycle) continue
    for (const market of event.markets ?? []) {
      if (market.status && market.status !== 'active' && market.status !== 'open') continue
      const pollCloseIso = pollCloseForKalshi(event, market, now)
      if (!pollCloseIso) continue
      const candidate = (market.yes_sub_title || market.title || '').trim()
      if (!candidate || candidate.length < 2) continue
      out.push({
        jurisdiction: 'US',
        office: office.office,
        cycle,
        district: office.district,
        candidate,
        pollCloseIso,
        kalshiPct: dollarsToPct(market.yes_bid_dollars, market.yes_ask_dollars, market.last_price_dollars),
        polymarketPct: null,
      })
    }
  }
  return out
}

type GammaMarket = {
  question?: string
  groupItemTitle?: string
  outcomes?: string | string[]
  outcomePrices?: string | string[]
  endDate?: string
}

type GammaEvent = {
  title?: string
  endDate?: string
  markets?: GammaMarket[]
  tags?: Array<{ slug?: string; label?: string }>
}

function asStringList(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function polymarketYesPct(market: GammaMarket): number | null {
  const outcomes = asStringList(market.outcomes)
  const prices = asStringList(market.outcomePrices).map(Number)
  const yesAt = outcomes.findIndex((o) => /^yes$/i.test(o.trim()))
  const idx = yesAt >= 0 ? yesAt : 0
  const p = prices[idx]
  if (!Number.isFinite(p) || p < 0 || p > 1) return null
  return Math.round(p * 1000) / 10
}

function guessOffice(title: string): { office: PoliticsOffice; district: string; cycle: string } | null {
  const year = title.match(/\b(20\d{2})\b/)
  const cycle = year?.[1] ?? ''
  if (!cycle) return null
  if (/presidential|president|대선/i.test(title)) return { office: 'president', district: '_', cycle }
  const gov = title.match(/\b([A-Z]{2})\b.*governor|governor.*\b([A-Z]{2})\b|georgia governor|조지아 주지사/i)
  if (/governor|주지사/i.test(title)) {
    const district = /georgia|조지아/i.test(title) ? 'GA' : (gov?.[1] || gov?.[2] || '_').toUpperCase()
    return { office: 'governor', district: district.length === 2 ? district : '_', cycle }
  }
  if (/senate|상원/i.test(title)) return { office: 'senate', district: '_', cycle }
  if (/house|하원/i.test(title)) return { office: 'house', district: '_', cycle }
  return null
}

export function parsePolymarketEvents(payload: unknown, now: Date): ElectionCandidateLite[] {
  const events = Array.isArray(payload)
    ? (payload as GammaEvent[])
    : ((payload as { events?: GammaEvent[] } | null)?.events ?? [])
  const out: ElectionCandidateLite[] = []
  for (const event of events) {
    const title = event.title ?? ''
    const office = guessOffice(title)
    if (!office) continue
    const end = event.endDate
    const pollCloseIso = end && inPoliticsWindow(end, now) ? new Date(Date.parse(end)).toISOString() : null
    if (!pollCloseIso) continue
    const markets = event.markets ?? []
    if (markets.length === 0) {
      continue
    }
    for (const market of markets) {
      const candidate = (market.groupItemTitle || market.question || title).trim()
      if (!candidate) continue
      out.push({
        jurisdiction: /korea|한국|대한민국/i.test(title) ? 'KR' : 'US',
        office: office.office,
        cycle: office.cycle,
        district: office.district,
        candidate: candidate.slice(0, 80),
        pollCloseIso,
        kalshiPct: null,
        polymarketPct: polymarketYesPct(market),
      })
    }
  }
  return out
}

export function mergeElectionSlate(rows: readonly ElectionCandidateLite[]): ElectionCandidateLite[] {
  const map = new Map<string, ElectionCandidateLite>()
  for (const row of rows) {
    const key = [row.jurisdiction, row.office, row.cycle, row.district, row.candidate.toLowerCase()].join('|')
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { ...row })
      continue
    }
    prev.kalshiPct = prev.kalshiPct ?? row.kalshiPct
    prev.polymarketPct = prev.polymarketPct ?? row.polymarketPct
    if (Date.parse(row.pollCloseIso) < Date.parse(prev.pollCloseIso)) prev.pollCloseIso = row.pollCloseIso
  }
  return [...map.values()]
}

export function subjectImpliedPct(row: Pick<ElectionCandidateLite, 'kalshiPct' | 'polymarketPct'>): number | null {
  const nums = [row.kalshiPct, row.polymarketPct].filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  if (!nums.length) return null
  const avg = nums.reduce((s, n) => s + n, 0) / nums.length
  return Math.round(avg * 10) / 10
}

async function readJson(res: Response): Promise<{ ok: boolean; status: number; body: unknown; blocked: boolean }> {
  const text = await res.text()
  const blocked = text.includes('error code: 1026') || text.includes('cf-error')
  if (!res.ok || blocked) return { ok: false, status: res.status, body: text.slice(0, 180), blocked }
  try {
    return { ok: true, status: res.status, body: JSON.parse(text) as unknown, blocked: false }
  } catch {
    return { ok: false, status: res.status, body: text.slice(0, 180), blocked: false }
  }
}

export async function fetchJsonRetry(
  url: string,
  fetchImpl: typeof fetch = fetch,
  attempts = 3,
): Promise<unknown> {
  let last = 'fetch failed'
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchImpl(url, { headers: POLY_HEADERS })
      const parsed = await readJson(res)
      if (parsed.ok) return parsed.body
      last = parsed.blocked ? `cloudflare 1026 (http ${parsed.status})` : `http ${parsed.status}`
      const retryable = parsed.blocked || parsed.status === 403 || parsed.status === 429 || parsed.status >= 500
      if (!retryable) break
    } catch (e: unknown) {
      last = e instanceof Error ? e.message : 'network'
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 350 * (i + 1)))
  }
  throw new Error(last)
}

export async function fetchKalshiElectionSlate(now: Date, fetchImpl: typeof fetch = fetch): Promise<ElectionCandidateLite[]> {
  const tickers: string[] = []
  let cursor = ''
  for (let page = 0; page < 3; page++) {
    const url = `${KALSHI_TRADE_ORIGIN}/series?category=Elections&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const body = (await fetchJsonRetry(url, fetchImpl, 2)) as {
      series?: Array<{ ticker?: string }>
      cursor?: string
    }
    for (const row of body.series ?? []) {
      const ticker = (row.ticker ?? '').toUpperCase()
      if (/^GOVPARTY[A-Z]{2}$/.test(ticker) || /^SENATE[A-Z]{2}$/.test(ticker) || /^HOUSE[A-Z]{2}\d+$/.test(ticker)) {
        tickers.push(ticker)
      }
    }
    cursor = body.cursor ?? ''
    if (!cursor) break
  }

  // Priority sort: high-interest state governor/senate races first
  const PRIORITY_FIRST = new Set([
    'GOVPARTYGA', 'SENATEGA', 'GOVPARTYTX', 'SENATETX', 'GOVPARTYCA', 'GOVPARTYNY',
    'GOVPARTYFL', 'SENATEFL', 'GOVPARTYPA', 'SENATEPA', 'GOVPARTYMI', 'SENATEMI',
    'GOVPARTYAZ', 'SENATEAZ', 'GOVPARTYWI', 'SENATEWI', 'GOVPARTYNC', 'SENATENC',
    'GOVPARTYNV', 'SENATENV', 'SENATEIL', 'SENATESC', 'SENATELA', 'HOUSENJ5', 'HOUSECA21',
  ])
  tickers.sort((a, b) => {
    const pa = PRIORITY_FIRST.has(a) ? 1 : 0
    const pb = PRIORITY_FIRST.has(b) ? 1 : 0
    return pb - pa
  })

  // Limit to 45 series, fetched in small batches with short delays to avoid 429 rate limits
  const chosen = tickers.slice(0, 45)
  const payloads: unknown[] = []
  for (let i = 0; i < chosen.length; i += 5) {
    const chunk = chosen.slice(i, i + 5)
    const pages = await Promise.all(
      chunk.map(async (ticker) => {
        try {
          return await fetchJsonRetry(
            `${KALSHI_TRADE_ORIGIN}/events?status=open&series_ticker=${encodeURIComponent(ticker)}&with_nested_markets=true&limit=4`,
            fetchImpl,
            2,
          )
        } catch {
          return null
        }
      }),
    )
    for (const page of pages) if (page) payloads.push(page)
    if (i + 5 < chosen.length) {
      await new Promise((r) => setTimeout(r, 120))
    }
  }
  return payloads.flatMap((page) => parseKalshiElectionEvents(page, now))
}

export async function fetchPolymarketPolitics(now: Date, fetchImpl: typeof fetch = fetch): Promise<ElectionCandidateLite[]> {
  const url = `${POLYMARKET_GAMMA_ORIGIN}/public-search?q=election&limit_per_type=20`
  try {
    const body = await fetchJsonRetry(url, fetchImpl)
    return parsePolymarketEvents(body, now)
  } catch {
    const fallback = `${POLYMARKET_GAMMA_ORIGIN}/events?active=true&closed=false&limit=40&order=volume24hr&ascending=false`
    const body = await fetchJsonRetry(fallback, fetchImpl)
    return parsePolymarketEvents(body, now)
  }
}
