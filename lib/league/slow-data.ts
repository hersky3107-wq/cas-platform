import 'server-only'

import { XMLParser } from 'fast-xml-parser'
import type { SlowDataSnapshot } from './closed-book-packet'

/**
 * Packet v2 (C) — SLOW PUBLIC DATA (server engine only). Free public
 * sources only; zero API-key cost:
 *
 *  1. FINRA daily short-sale volume  — cdn.finra.org CNMS daily file (probed
 *     live 2026-08-28: reliable, pipe-delimited, walk-back to last trading day)
 *  2. CBOE daily put/call ratios     — cboe.com daily market-statistics page;
 *     ratios are embedded as JSON in the page markup (probed live: reliable;
 *     the day's data appears with a lag, so walk-back is required)
 *  3. Farside BTC spot ETF flows     — PROBED UNRELIABLE (HTTP 403 Cloudflare
 *     even with browser headers). Still attempted once per day so a future
 *     unblock starts working, but expect a labeled UNAVAILABLE line.
 *  4. SEC EDGAR Form 4 insider txns  — data.sec.gov + Archives (probed live:
 *     reliable; raw ownership XML fetchable after stripping the xsl prefix)
 *
 * All numeric, all with source + as-of, UNAVAILABLE labeled explicitly on
 * failure — never guessed. Everything cached in-process per UTC day.
 */

const FETCH_TIMEOUT_MS = 15_000
const WALK_BACK_DAYS = 7
export const INSIDER_WINDOW_DAYS = 90
/** Bound the per-round EDGAR request count (1 tickers + 1 submissions + N docs). */
const INSIDER_MAX_FILINGS = 12

const UA = 'cas-platform-league-research/1.0 (contact: admin@cas-platform.example)'

type Fail = { unavailable: string }

async function getText(url: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string } | { error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA, ...headers } })
    const text = await res.text()
    return { status: res.status, text }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { error: msg.toLowerCase().includes('abort') ? `timeout after ${FETCH_TIMEOUT_MS}ms` : msg }
  } finally {
    clearTimeout(timer)
  }
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Last WALK_BACK_DAYS weekday dates, most recent first (holiday-agnostic; a 404/no-data day just walks further back). */
function recentWeekdays(): Date[] {
  const out: Date[] = []
  for (let back = 0; back < WALK_BACK_DAYS + 3 && out.length < WALK_BACK_DAYS; back++) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - back)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(d)
  }
  return out
}

/** Generic per-UTC-day memo. Success-only: failures retry on the next round. */
const dayMemo = new Map<string, unknown>()
async function memoDaily<T>(key: string, fn: () => Promise<T | Fail>): Promise<T | Fail> {
  const k = `${key}|${utcDay()}`
  const hit = dayMemo.get(k)
  if (hit !== undefined) return hit as T | Fail
  const value = await fn()
  if (!(typeof value === 'object' && value !== null && 'unavailable' in value)) {
    if (dayMemo.size > 500) {
      const today = utcDay()
      for (const existing of dayMemo.keys()) {
        if (!existing.endsWith(today)) dayMemo.delete(existing)
      }
    }
    dayMemo.set(k, value)
  }
  return value
}

// ── 1. FINRA daily short-sale volume ────────────────────────────────────────

type ShortVolume = { date: string; shortShares: number; totalShares: number; shortPct: number }

/** The daily CNMS file covers all symbols; cache the raw text once per day. */
async function finraDailyFile(): Promise<{ date: string; text: string } | Fail> {
  const result = await memoDaily('finra-file', async () => {
    let lastErr = 'no weekday file found'
    for (const d of recentWeekdays()) {
      const ymd = d.toISOString().slice(0, 10).replace(/-/g, '')
      const url = `https://cdn.finra.org/equity/regsho/daily/CNMSshvol${ymd}.txt`
      const res = await getText(url)
      if ('error' in res) {
        lastErr = `${url}: ${res.error}`
        continue
      }
      if (res.status === 200 && res.text.startsWith('Date|')) {
        return { date: d.toISOString().slice(0, 10), text: res.text }
      }
      lastErr = `${url}: HTTP ${res.status}`
    }
    return { unavailable: `FINRA CNMS daily file: ${lastErr}` }
  })
  return result
}

async function fetchShortVolume(symbol: string): Promise<ShortVolume | Fail> {
  return memoDaily(`finra|${symbol}`, async () => {
    const file = await finraDailyFile()
    if ('unavailable' in file) return file
    // Format: Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market
    const row = file.text.split('\n').find((l) => l.includes(`|${symbol}|`))
    if (!row) return { unavailable: `FINRA CNMS ${file.date}: symbol ${symbol} not in file` }
    const parts = row.split('|')
    const shortShares = Number(parts[2])
    const totalShares = Number(parts[4])
    if (!Number.isFinite(shortShares) || !Number.isFinite(totalShares) || totalShares <= 0) {
      return { unavailable: `FINRA CNMS ${file.date}: unparseable row for ${symbol}` }
    }
    return { date: file.date, shortShares, totalShares, shortPct: (shortShares / totalShares) * 100 }
  })
}

// ── 2. CBOE daily put/call ratios ───────────────────────────────────────────

type PutCall = { date: string; total: number; index: number | null; equity: number | null }

/** Ratios ship inside the page as (escaped) JSON: {"name":"TOTAL PUT/CALL RATIO","value":"0.73"}. */
function parseCboeRatio(html: string, label: string): number | null {
  const re = new RegExp(`${label.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}[^0-9]*([0-9]+\\.?[0-9]*)`, 'i')
  const m = html.match(re)
  const n = m ? Number(m[1]) : NaN
  return Number.isFinite(n) ? n : null
}

async function fetchPutCall(): Promise<PutCall | Fail> {
  return memoDaily('cboe-putcall', async () => {
    let lastErr = 'no weekday page had ratios'
    for (const d of recentWeekdays()) {
      const day = d.toISOString().slice(0, 10)
      const url = `https://www.cboe.com/us/options/market_statistics/daily/?dt=${day}`
      const res = await getText(url, { Accept: 'text/html' })
      if ('error' in res) {
        lastErr = `${url}: ${res.error}`
        continue
      }
      if (res.status !== 200) {
        lastErr = `${url}: HTTP ${res.status}`
        continue
      }
      const total = parseCboeRatio(res.text, 'TOTAL PUT/CALL RATIO')
      if (total == null) continue // page exists but the day's data not published yet
      return {
        date: day,
        total,
        index: parseCboeRatio(res.text, 'INDEX PUT/CALL RATIO'),
        equity: parseCboeRatio(res.text, 'EQUITY PUT/CALL RATIO'),
      }
    }
    return { unavailable: `CBOE daily market statistics: ${lastErr}` }
  })
}

// ── 3. Farside BTC spot ETF flows (probed unreliable — attempted anyway) ────

type BtcEtfFlow = { date: string; netFlowUsdM: number }

function parseFarsideCell(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim()
  const neg = /^\(.*\)$/.test(cleaned)
  const n = Number(cleaned.replace(/[()]/g, ''))
  if (!Number.isFinite(n)) return null
  return neg ? -n : n
}

async function fetchBtcEtfFlow(): Promise<BtcEtfFlow | Fail> {
  return memoDaily('farside-btc', async () => {
    const res = await getText('https://farside.co.uk/btc/', { Accept: 'text/html' })
    if ('error' in res) return { unavailable: `Farside farside.co.uk/btc: ${res.error}` }
    if (res.status !== 200) {
      return { unavailable: `Farside farside.co.uk/btc: HTTP ${res.status} (Cloudflare-blocked at probe time 2026-08-28)` }
    }
    const rows = res.text.match(/<tr[\s\S]*?<\/tr>/gi) ?? []
    const dataRows = rows.filter((r) => /\d{1,2} \w{3} \d{4}/.test(r))
    const lastRow = dataRows[dataRows.length - 1]
    if (!lastRow) return { unavailable: 'Farside: no dated table rows found' }
    const cells = lastRow
      .replace(/<t[dh][^>]*>/gi, '\u0000')
      .replace(/<[^>]+>/g, '')
      .split('\u0000')
      .map((c) => c.trim())
      .filter(Boolean)
    const dateCell = cells[0] ?? ''
    const totalCell = cells[cells.length - 1] ?? ''
    const total = parseFarsideCell(totalCell)
    if (total == null) return { unavailable: `Farside: could not parse Total cell "${totalCell}"` }
    return { date: dateCell, netFlowUsdM: total }
  })
}

// ── 4. SEC EDGAR Form 4 insider transactions ────────────────────────────────

type Insider = {
  windowDays: number
  buyTxns: number
  buyShares: number
  sellTxns: number
  sellShares: number
  netShares: number
  latestFilingDate: string | null
}

let tickerCikCache: Map<string, number> | null = null

async function tickerToCik(symbol: string): Promise<number | Fail> {
  if (!tickerCikCache) {
    const res = await getText('https://www.sec.gov/files/company_tickers.json')
    if ('error' in res) return { unavailable: `SEC company_tickers.json: ${res.error}` }
    if (res.status !== 200) return { unavailable: `SEC company_tickers.json: HTTP ${res.status}` }
    try {
      const map = JSON.parse(res.text) as Record<string, { cik_str: number; ticker: string }>
      tickerCikCache = new Map(Object.values(map).map((r) => [r.ticker.toUpperCase(), r.cik_str]))
    } catch {
      return { unavailable: 'SEC company_tickers.json: JSON parse failed' }
    }
  }
  const cik = tickerCikCache.get(symbol.toUpperCase())
  return cik ?? { unavailable: `SEC EDGAR: no CIK for ticker ${symbol}` }
}

const xml = new XMLParser({ ignoreAttributes: true })

function asArray<T>(v: T | T[] | undefined): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v]
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function fetchInsider(symbol: string): Promise<Insider | Fail> {
  return memoDaily(`edgar|${symbol}`, async () => {
    const cik = await tickerToCik(symbol)
    if (typeof cik !== 'number') return cik

    const subsRes = await getText(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`)
    if ('error' in subsRes) return { unavailable: `SEC submissions: ${subsRes.error}` }
    if (subsRes.status !== 200) return { unavailable: `SEC submissions: HTTP ${subsRes.status}` }

    let recent: { form?: string[]; accessionNumber?: string[]; primaryDocument?: string[]; filingDate?: string[] }
    try {
      recent = JSON.parse(subsRes.text)?.filings?.recent ?? {}
    } catch {
      return { unavailable: 'SEC submissions: JSON parse failed' }
    }

    const forms = recent.form ?? []
    const cutoff = new Date(Date.now() - INSIDER_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
    const picks: { acc: string; doc: string; date: string }[] = []
    for (let i = 0; i < forms.length && picks.length < INSIDER_MAX_FILINGS; i++) {
      const date = recent.filingDate?.[i] ?? ''
      if (forms[i] !== '4' || date < cutoff) continue
      const doc = (recent.primaryDocument?.[i] ?? '').split('/').pop() ?? ''
      const acc = (recent.accessionNumber?.[i] ?? '').replace(/-/g, '')
      if (doc && acc) picks.push({ acc, doc, date })
    }
    if (!picks.length) {
      return { windowDays: INSIDER_WINDOW_DAYS, buyTxns: 0, buyShares: 0, sellTxns: 0, sellShares: 0, netShares: 0, latestFilingDate: null }
    }

    let buyTxns = 0
    let buyShares = 0
    let sellTxns = 0
    let sellShares = 0
    let parsedAny = false
    for (const p of picks) {
      const docRes = await getText(`https://www.sec.gov/Archives/edgar/data/${cik}/${p.acc}/${p.doc}`)
      if ('error' in docRes || docRes.status !== 200) continue
      try {
        const parsed = xml.parse(docRes.text) as { ownershipDocument?: { nonDerivativeTable?: { nonDerivativeTransaction?: unknown } } }
        const txns = asArray(parsed?.ownershipDocument?.nonDerivativeTable?.nonDerivativeTransaction) as {
          transactionCoding?: { transactionCode?: unknown }
          transactionAmounts?: { transactionShares?: { value?: unknown } }
        }[]
        for (const t of txns) {
          const code = String(t?.transactionCoding?.transactionCode ?? '')
          const shares = num(t?.transactionAmounts?.transactionShares?.value)
          if (shares == null) continue
          // Open-market purchases (P) and sales (S) only — option exercises,
          // gifts, and tax withholding are not sentiment.
          if (code === 'P') {
            buyTxns += 1
            buyShares += shares
            parsedAny = true
          } else if (code === 'S') {
            sellTxns += 1
            sellShares += shares
            parsedAny = true
          } else {
            parsedAny = true
          }
        }
      } catch {
        // one malformed filing must not sink the aggregate
      }
    }
    if (!parsedAny) return { unavailable: `SEC EDGAR: ${picks.length} Form 4 filings found but none parseable` }
    return {
      windowDays: INSIDER_WINDOW_DAYS,
      buyTxns,
      buyShares,
      sellTxns,
      sellShares,
      netShares: buyShares - sellShares,
      latestFilingDate: picks[0]?.date ?? null,
    }
  })
}

// ── entry point ─────────────────────────────────────────────────────────────

const SHORT_VOLUME_CATEGORIES = new Set(['stock', 'etf_index', 'real_estate'])
const PUT_CALL_CATEGORIES = new Set(['stock', 'etf_index', 'real_estate'])
const CRYPTO_CATEGORIES = new Set(['crypto_spot', 'crypto_perps', 'memecoin'])
const INSIDER_CATEGORIES = new Set(['stock'])

/**
 * Slow-data snapshot for one round. Returns null when NOTHING applies to the
 * category (fx, metals, commodities…) so the packet omits the section.
 * `symbol` is the Twelve Data symbol (plain US ticker) when known.
 */
export async function fetchSlowData(args: {
  category: string
  symbol?: string
}): Promise<SlowDataSnapshot | null> {
  const { category, symbol } = args
  const isUsTicker = !!symbol && /^[A-Z.]{1,6}$/.test(symbol)

  const wantsShort = SHORT_VOLUME_CATEGORIES.has(category) && isUsTicker
  const wantsPutCall = PUT_CALL_CATEGORIES.has(category)
  const wantsBtcFlow = CRYPTO_CATEGORIES.has(category)
  const wantsInsider = INSIDER_CATEGORIES.has(category) && isUsTicker

  if (!wantsShort && !wantsPutCall && !wantsBtcFlow && !wantsInsider) return null

  const [shortVolume, putCall, btcEtfFlow, insider] = await Promise.all([
    wantsShort ? fetchShortVolume(symbol!) : Promise.resolve(null),
    wantsPutCall ? fetchPutCall() : Promise.resolve(null),
    wantsBtcFlow ? fetchBtcEtfFlow() : Promise.resolve(null),
    wantsInsider ? fetchInsider(symbol!) : Promise.resolve(null),
  ])

  return { fetchedAt: new Date().toISOString(), shortVolume, putCall, btcEtfFlow, insider }
}
