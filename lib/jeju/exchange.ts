import 'server-only'

/**
 * Live exchange rates for Jeju foreign visitors — Korea Eximbank open API.
 *
 * Endpoint (2025 domain change → oapi.koreaexim.go.kr):
 *   GET .../exchangeJSON?authkey=KEY&searchdate=YYYYMMDD&data=AP01
 * Returns an array of { result, cur_unit, cur_nm, deal_bas_r, ... }.
 *
 * API QUIRKS handled here:
 *   - Empty body ([]) on weekends/holidays and before ~11:00 KST on business
 *     days → we walk searchdate back up to 5 days until a non-empty result.
 *   - Per-item `result` code: 1 ok, 2 no-data, 3 auth error, 4 daily limit.
 *     3/4 abort early (retrying other dates is pointless); 2/empty walk back.
 *   - `deal_bas_r` is a comma-grouped string ("1,389.50").
 *   - Some currencies are quoted per 100 (cur_unit "JPY(100)"); the unit is
 *     parsed from the cur_unit and surfaced so the UI can label it correctly.
 *
 * CONTRACT: 'server-only' (authkey never reaches the client), ~10s timeout,
 * never throws (returns { ok, data } | { ok:false, error }), key masked in logs.
 * Successful results are cached in-memory for the current KST day.
 */

const BASE = 'https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON'
const TIMEOUT_MS = 10_000
/** How many days back to walk when the requested date has no data. */
const MAX_LOOKBACK_DAYS = 5

// ── Domain types ───────────────────────────────────────────────────────────────

export interface ExchangeRate {
  /** Display currency code (CNH is normalized to CNY). */
  code: string
  /** Quote unit — 1 for most, 100 for JPY etc. KRW `rate` is per this many. */
  unit: number
  /** Base rate in KRW per `unit` of the currency. */
  rate: number
}

export interface ExchangeRatesData {
  /** The business date actually used (YYYY-MM-DD) — may be a prior day. */
  date: string
  rates: ExchangeRate[]
}

export type ExchangeResult =
  | { ok: true; data: ExchangeRatesData }
  | { ok: false; error: string }

/**
 * Currencies most relevant to Jeju's foreign visitors, in display order.
 * `match` lists the raw cur_unit tokens that map to this display `code`
 * (Eximbank quotes China as offshore "CNH"; we surface it as CNY).
 * TWD is requested but not part of AP01 — it simply won't appear if absent.
 */
const CURATED: ReadonlyArray<{ code: string; match: readonly string[] }> = [
  { code: 'USD', match: ['USD'] },
  { code: 'CNY', match: ['CNH', 'CNY'] },
  { code: 'JPY', match: ['JPY(100)', 'JPY'] },
  { code: 'EUR', match: ['EUR'] },
  { code: 'HKD', match: ['HKD'] },
  { code: 'TWD', match: ['TWD'] },
]

interface RawRate {
  result?: number
  cur_unit?: string
  cur_nm?: string
  deal_bas_r?: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Mask the authkey before logging a URL. */
function masked(url: string): string {
  return url.replace(/authkey=[^&]+/i, 'authkey=***')
}

/** KST-anchored date `daysBack` days ago, as { compact: YYYYMMDD, iso: YYYY-MM-DD }. */
function kstDate(daysBack: number): { compact: string; iso: string } {
  const ms = Date.now() + 9 * 3_600_000 - daysBack * 86_400_000
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return { compact: `${y}${m}${day}`, iso: `${y}-${m}-${day}` }
}

type FetchOutcome =
  | { status: 'ok'; items: RawRate[] }
  | { status: 'empty' }
  | { status: 'auth' }
  | { status: 'error' }

/** One Eximbank call for a specific searchdate. Never throws. */
async function fetchForDate(compactDate: string): Promise<FetchOutcome> {
  const key = process.env.KOREAEXIM_API_KEY ?? ''
  if (!key) {
    console.error('[exchange] KOREAEXIM_API_KEY not configured')
    return { status: 'error' }
  }

  const url = `${BASE}?authkey=${key}&searchdate=${compactDate}&data=AP01`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) {
      console.error(`[exchange] HTTP ${res.status} for ${masked(url)}`)
      return { status: 'error' }
    }

    const text = await res.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      console.error(`[exchange] unparseable response for ${masked(url)}: ${text.slice(0, 160)}`)
      return { status: 'error' }
    }

    if (!Array.isArray(parsed) || parsed.length === 0) return { status: 'empty' }

    const items = parsed as RawRate[]
    const code = typeof items[0]?.result === 'number' ? items[0]!.result : 1
    if (code === 3) {
      console.error('[exchange] auth error (result=3) — check KOREAEXIM_API_KEY')
      return { status: 'auth' }
    }
    if (code === 4) {
      console.error('[exchange] daily request limit reached (result=4)')
      return { status: 'auth' }
    }
    if (code === 2) return { status: 'empty' } // no data for this date

    return { status: 'ok', items }
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError'
    console.error(`[exchange] ${aborted ? 'timeout' : 'fetch error'} for ${masked(url)}`)
    return { status: 'error' }
  } finally {
    clearTimeout(timer)
  }
}

/** Pick the curated currencies (in order) out of a raw Eximbank row set. */
function curate(items: RawRate[]): ExchangeRate[] {
  const out: ExchangeRate[] = []
  for (const c of CURATED) {
    const found = items.find((it) => {
      const u = (it.cur_unit ?? '').trim()
      const base = u.replace(/\(\d+\)/, '').trim()
      return c.match.includes(u) || c.match.includes(base)
    })
    if (!found) continue

    const u = (found.cur_unit ?? '').trim()
    const unitMatch = u.match(/\((\d+)\)/)
    const unit = unitMatch ? Number(unitMatch[1]) : 1
    const rate = Number(String(found.deal_bas_r ?? '').replace(/,/g, ''))
    if (!Number.isFinite(rate) || rate <= 0) continue

    out.push({ code: c.code, unit, rate })
  }
  return out
}

// ── Public API ────────────────────────────────────────────────────────────────

let cache: { day: string; data: ExchangeRatesData } | null = null

/**
 * Live KRW reference rates for the curated visitor currencies, using the most
 * recent business day with data. Cached in-memory for the current KST day.
 */
export async function getExchangeRates(): Promise<ExchangeResult> {
  const todayKey = kstDate(0).iso
  if (cache && cache.day === todayKey) return { ok: true, data: cache.data }

  for (let back = 0; back <= MAX_LOOKBACK_DAYS; back++) {
    const { compact, iso } = kstDate(back)
    const r = await fetchForDate(compact)

    if (r.status === 'auth') return { ok: false, error: 'Exchange rate service unavailable' }
    if (r.status === 'error' || r.status === 'empty') continue // walk back a day

    const rates = curate(r.items)
    if (rates.length === 0) continue

    const data: ExchangeRatesData = { date: iso, rates }
    cache = { day: todayKey, data }
    return { ok: true, data }
  }

  return { ok: false, error: 'No exchange rate data available' }
}
