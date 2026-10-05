import type { CotPositioning, EtfHoldings } from './closed-book-packet'

/**
 * Pure parsers for gold/metals packet feeds. No fetches — so unit tests
 * never import `server-only`.
 */

/** Split a CFTC disagg line (quoted market name, then comma fields). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else if (c === '"') {
        inQ = false
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQ = true
    } else if (c === ',') {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur.trim())
  return out
}

function num(raw: string | undefined): number | null {
  if (raw == null || raw === '.' || raw === '') return null
  const n = Number(raw.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Disaggregated Futures-Only layout (CFTC f_disagg.txt, 0-based):
 * 2 = report date, 3 = CFTC_Contract_Market_Code,
 * 7 = open interest, 13/14 = managed-money long/short.
 */
export function parseCftcManagedMoney(line: string, contractCode: string): Exclude<CotPositioning, { unavailable: string }> | null {
  const cols = splitCsvLine(line)
  const code = (cols[3] ?? '').replace(/\s+/g, '')
  if (code !== contractCode) return null
  const date = cols[2] ?? ''
  const openInterest = num(cols[7])
  const managedMoneyLong = num(cols[13])
  const managedMoneyShort = num(cols[14])
  if (!date || openInterest == null || managedMoneyLong == null || managedMoneyShort == null) return null
  return {
    contract: cols[0] || contractCode,
    date,
    openInterest,
    managedMoneyLong,
    managedMoneyShort,
    managedMoneyNet: managedMoneyLong - managedMoneyShort,
  }
}

function findYieldField(obj: unknown): { date: string; yieldPct: number } | null {
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  const dateRaw = rec.NEW_DATE ?? rec.new_date ?? rec.Date ?? rec.date
  const y10 = rec.TC_10YEAR ?? rec.tc_10year ?? rec.TC_10Year
  const yieldPct = typeof y10 === 'number' ? y10 : Number(String(y10 ?? ''))
  const date = String(dateRaw ?? '').slice(0, 10)
  if (!date || !Number.isFinite(yieldPct)) return null
  return { date, yieldPct }
}

export function parseTreasuryRealYieldCsv(text: string): { date: string; yieldPct: number } | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return null
  const header = splitCsvLine(lines[0]!).map((h) => h.replace(/^"|"$/g, '').trim().toUpperCase())
  const tenIdx = header.findIndex((h) => h === '10 YR' || h === '10YR' || h === '10-YEAR' || h === '10 YEAR')
  const dateIdx = header.findIndex((h) => h === 'DATE')
  if (tenIdx < 0 || dateIdx < 0) return null
  let best: { date: string; yieldPct: number } | null = null
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line)
    const dateRaw = cols[dateIdx] ?? ''
    const yieldPct = Number((cols[tenIdx] ?? '').replace(/,/g, ''))
    const iso = toIsoDate(dateRaw)
    if (!iso || !Number.isFinite(yieldPct)) continue
    if (!best || iso > best.date) best = { date: iso, yieldPct }
  }
  return best
}

function toIsoDate(raw: string): string | null {
  const trimmed = raw.trim()
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!mdy) return null
  return `${mdy[3]}-${mdy[1]!.padStart(2, '0')}-${mdy[2]!.padStart(2, '0')}`
}

export const TROY_OZ_PER_TONNE = 32150.7466
/** Fallback oz-per-share when the issuer does not publish metal entitlement. */
export const GLD_OZ_PER_SHARE = 0.093
export const SLV_OZ_PER_SHARE = 0.92

const MONTH_NUM: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
}

export function parseEnglishDate(raw: string): string | null {
  const iso = toIsoDate(raw)
  if (iso) return iso
  const m = raw.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/)
  if (!m) return null
  const mon = MONTH_NUM[m[1]!.toLowerCase()]
  if (!mon) return null
  return `${m[3]}-${mon}-${m[2]!.padStart(2, '0')}`
}

export function parseSpdrNumeric(raw: string): number | null {
  const cleaned = raw.replace(/US\$/gi, '').replace(/,/g, '').replace(/%/g, '').trim()
  if (!cleaned || cleaned === '.' || cleaned === '-') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function spdrField(
  data: Record<string, { value?: unknown; date?: unknown } | undefined>,
  key: string,
): { value: number | null; date: string | null } {
  const rec = data[key]
  const value = rec?.value == null ? null : parseSpdrNumeric(String(rec.value))
  const date = rec?.date == null ? null : parseEnglishDate(String(rec.date))
  return { value, date }
}

/** Official SPDR Gold Shares JSON (`api.spdrgoldshares.com/api/v1/data`). */
export function parseSpdrGoldData(json: unknown): Exclude<EtfHoldings, { unavailable: string }> | null {
  if (!json || typeof json !== 'object') return null
  const data = (json as { data?: Record<string, { value?: unknown; date?: unknown }> }).data
  if (!data || typeof data !== 'object') return null
  const ounces = spdrField(data, 'total_ounces')
  const tonnes = spdrField(data, 'total_tonnes')
  const shares = spdrField(data, 'shares_outstanding')
  const date = ounces.date ?? tonnes.date ?? shares.date
  if (!date) return null
  let oz = ounces.value
  let t = tonnes.value
  if (oz == null && t != null) oz = t * TROY_OZ_PER_TONNE
  if (t == null && oz != null) t = oz / TROY_OZ_PER_TONNE
  if (oz == null && t == null && shares.value != null) {
    oz = shares.value * GLD_OZ_PER_SHARE
    t = oz / TROY_OZ_PER_TONNE
  }
  if (oz == null && t == null) return null
  return {
    date,
    tonnes: t,
    ounces: oz,
    source: 'SPDR Gold Shares api.spdrgoldshares.com',
  }
}

export function holdingsFromShares(
  date: string,
  shares: number,
  ozPerShare: number,
  source: string,
): Exclude<EtfHoldings, { unavailable: string }> | null {
  if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(ozPerShare) || ozPerShare <= 0) return null
  const ounces = shares * ozPerShare
  return {
    date,
    ounces,
    tonnes: ounces / TROY_OZ_PER_TONNE,
    source,
  }
}

function pickShareNumber(json: Record<string, unknown>): number | null {
  for (const key of ['shares_outstanding', 'sharesOutstanding', 'sharesoutstanding']) {
    const n = Number(json[key])
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

/** Twelve Data `/quote` — Grow plan often omits this; keep the probe so it works if they add it. */
export function parseTwelveDataSharesOutstanding(json: unknown): number | null {
  if (!json || typeof json !== 'object') return null
  const rec = json as Record<string, unknown>
  const direct = pickShareNumber(rec)
  if (direct != null) return direct
  const stats = rec.statistics
  if (stats && typeof stats === 'object') {
    const nested = pickShareNumber(stats as Record<string, unknown>)
    if (nested != null) return nested
  }
  return null
}

/**
 * iShares product page embeds HTML-escaped JSON with sharesOutstanding.
 * The ajax holdings CSV/JSON is Cloudflare-walled; this HTML field is not.
 */
export function parseIsharesSharesOutstanding(html: string): { date: string; shares: number } | null {
  const unescaped = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  const block = unescaped.match(/sharesOutstanding"\s*:\s*\{([^}]+)\}/)
  if (!block) return null
  const inner = block[1] ?? ''
  const value = inner.match(/"formattedValue"\s*:\s*"([^"]+)"/)
  const asOf = inner.match(/"formattedAsOfDate"\s*:\s*"([^"]+)"/)
  if (!value || !asOf) return null
  const shares = parseSpdrNumeric(value[1]!)
  const date = parseEnglishDate(asOf[1]!)
  if (shares == null || shares <= 0 || !date) return null
  return { date, shares }
}

/** FRED `fredgraph.csv` — last numeric observation (`.` is a missing value). */
export function parseFredCsvLast(text: string): { date: string; value: number } | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return null
  let best: { date: string; value: number } | null = null
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line)
    const date = (cols[0] ?? '').trim()
    const raw = (cols[1] ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || raw === '.' || raw === '') continue
    const value = Number(raw)
    if (!Number.isFinite(value)) continue
    if (!best || date > best.date) best = { date, value }
  }
  return best
}

export type FredChangeSnap = {
  seriesId: string
  date: string
  value: number
  change1w: number | null
  change1m: number | null
  date1w: string | null
  date1m: string | null
}

export type CotHistoryRow = {
  date: string
  contract: string
  code: string
  openInterest: number
  managedMoneyLong: number
  managedMoneyShort: number
  managedMoneyNet: number
}

export type EtfFlowSnap = {
  symbol: string
  date: string
  lastClose: number
  change5dPct: number | null
  change20dPct: number | null
  lastVolume: number | null
  avgVolume20: number | null
  volumeVs20dPct: number | null
  source: string
}

export type MacroEventSnap = { date: string; name: string; source: string }

/** All numeric FRED CSV rows (`.` skipped). */
export function parseFredCsvObservations(text: string): { date: string; value: number }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const out: { date: string; value: number }[] = []
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line)
    const date = (cols[0] ?? '').trim()
    const raw = (cols[1] ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || raw === '.' || raw === '') continue
    const value = Number(raw)
    if (!Number.isFinite(value)) continue
    out.push({ date, value })
  }
  out.sort((a, b) => a.date.localeCompare(b.date))
  return out
}

export function parseFredApiObservations(json: unknown): { date: string; value: number }[] {
  if (!json || typeof json !== 'object') return []
  const rows = (json as { observations?: unknown }).observations
  if (!Array.isArray(rows)) return []
  const out: { date: string; value: number }[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as { date?: unknown; value?: unknown }
    const date = String(rec.date ?? '').slice(0, 10)
    const raw = String(rec.value ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || raw === '.' || raw === '') continue
    const value = Number(raw)
    if (!Number.isFinite(value)) continue
    out.push({ date, value })
  }
  out.sort((a, b) => a.date.localeCompare(b.date))
  return out
}

function addUtcDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function priorOnOrBefore(
  obs: { date: string; value: number }[],
  target: string,
  latestDate: string,
): { date: string; value: number } | null {
  let best: { date: string; value: number } | null = null
  for (const row of obs) {
    if (row.date > target) break
    if (row.date >= latestDate) continue
    best = row
  }
  return best
}

export function fredChangeFromObservations(
  seriesId: string,
  obs: { date: string; value: number }[],
): FredChangeSnap | null {
  if (!obs.length) return null
  const latest = obs[obs.length - 1]!
  const week = priorOnOrBefore(obs, addUtcDays(latest.date, -7), latest.date)
  const month = priorOnOrBefore(obs, addUtcDays(latest.date, -30), latest.date)
  const delta = (prior: { value: number } | null | undefined): number | null =>
    prior == null ? null : Math.round((latest.value - prior.value) * 1e6) / 1e6
  return {
    seriesId,
    date: latest.date,
    value: latest.value,
    change1w: delta(week),
    change1m: delta(month),
    date1w: week?.date ?? null,
    date1m: month?.date ?? null,
  }
}

function socrataNum(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') return num(raw)
  return null
}

export function parseCftcSocrataRows(json: unknown, contractCode: string): CotHistoryRow[] {
  if (!Array.isArray(json)) return []
  const out: CotHistoryRow[] = []
  for (const row of json) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const code = String(rec.cftc_contract_market_code ?? rec.cftc_contract_market_code_quotes ?? '').replace(/\s+/g, '')
    if (code !== contractCode) continue
    const date = String(rec.report_date_as_yyyy_mm_dd ?? '').slice(0, 10)
    const openInterest = socrataNum(rec.open_interest_all)
    const managedMoneyLong = socrataNum(rec.m_money_positions_long_all)
    const managedMoneyShort = socrataNum(rec.m_money_positions_short_all)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || openInterest == null || managedMoneyLong == null || managedMoneyShort == null) {
      continue
    }
    out.push({
      date,
      contract: String(rec.market_and_exchange_names ?? contractCode),
      code,
      openInterest,
      managedMoneyLong,
      managedMoneyShort,
      managedMoneyNet: managedMoneyLong - managedMoneyShort,
    })
  }
  out.sort((a, b) => a.date.localeCompare(b.date))
  return out
}

export function cotHistoryStats(rows: CotHistoryRow[]): {
  change4w: number | null
  percentile3y: number | null
  historyWeeks: number
} | null {
  if (!rows.length) return null
  const latest = rows[rows.length - 1]!
  const floor3y = addUtcDays(latest.date, -1096)
  const window = rows.filter((r) => r.date >= floor3y)
  const prior4 = priorCot(rows, addUtcDays(latest.date, -28), latest.date)
  const n = window.length
  let atOrBelow = 0
  for (const row of window) {
    if (row.managedMoneyNet <= latest.managedMoneyNet) atOrBelow += 1
  }
  return {
    change4w: prior4 ? latest.managedMoneyNet - prior4.managedMoneyNet : null,
    percentile3y: n > 0 ? (atOrBelow / n) * 100 : null,
    historyWeeks: n,
  }
}

function priorCot(rows: CotHistoryRow[], target: string, latestDate: string): CotHistoryRow | null {
  let best: CotHistoryRow | null = null
  for (const row of rows) {
    if (row.date > target) break
    if (row.date >= latestDate) continue
    best = row
  }
  return best
}

export function parseTwelveDataBars(json: unknown): { date: string; close: number; volume: number | null }[] {
  if (!json || typeof json !== 'object') return []
  const values = (json as { values?: unknown }).values
  if (!Array.isArray(values)) return []
  const out: { date: string; close: number; volume: number | null }[] = []
  for (const row of values) {
    if (!row || typeof row !== 'object') continue
    const rec = row as { datetime?: unknown; close?: unknown; volume?: unknown }
    const date = String(rec.datetime ?? '').slice(0, 10)
    const close = Number(rec.close)
    const volRaw = rec.volume == null || rec.volume === '' ? null : Number(rec.volume)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close)) continue
    out.push({
      date,
      close,
      volume: volRaw != null && Number.isFinite(volRaw) ? volRaw : null,
    })
  }
  out.sort((a, b) => a.date.localeCompare(b.date))
  return out
}

export function etfFlowFromBars(
  symbol: string,
  bars: { date: string; close: number; volume: number | null }[],
  source: string,
): EtfFlowSnap | null {
  if (!bars.length) return null
  const latest = bars[bars.length - 1]!
  const d5 = bars.length >= 6 ? bars[bars.length - 6]! : null
  const d20 = bars.length >= 21 ? bars[bars.length - 21]! : null
  const last20 = bars.slice(-20)
  const vols = last20.map((b) => b.volume).filter((v): v is number => v != null && v > 0)
  const avgVolume20 = vols.length >= 10 ? vols.reduce((s, v) => s + v, 0) / vols.length : null
  const lastVolume = latest.volume
  return {
    symbol,
    date: latest.date,
    lastClose: latest.close,
    change5dPct: d5 ? ((latest.close - d5.close) / d5.close) * 100 : null,
    change20dPct: d20 ? ((latest.close - d20.close) / d20.close) * 100 : null,
    lastVolume,
    avgVolume20,
    volumeVs20dPct: lastVolume != null && avgVolume20 != null && avgVolume20 > 0 ? (lastVolume / avgVolume20 - 1) * 100 : null,
    source,
  }
}

const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December'

export function parseFomcMeetingDates(html: string, year: number): MacroEventSnap[] {
  const yearBlock = html.match(new RegExp(`${year}\\s+FOMC[\\s\\S]{0,4000}`, 'i'))?.[0] ?? html
  const re = new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2})(?:\\s*[-–]\\s*(\\d{1,2}))?`, 'gi')
  const out: MacroEventSnap[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(yearBlock)) !== null) {
    const mon = MONTH_NUM[m[1]!.toLowerCase()]
    if (!mon) continue
    const day = (m[3] ?? m[2]!).padStart(2, '0')
    out.push({ date: `${year}-${mon}-${day}`, name: 'FOMC', source: 'federalreserve.gov FOMC calendars' })
  }
  return uniqueEvents(out)
}

export function parseBlsReleaseDates(html: string, name: 'CPI' | 'payrolls'): MacroEventSnap[] {
  const re = new RegExp(`\\b(${MONTHS}|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Sept\\.?|Oct\\.?|Nov\\.?|Dec\\.?)\\s+(\\d{1,2}),\\s*(\\d{4})`, 'gi')
  const out: MacroEventSnap[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const rawMon = m[1]!.replace(/\./g, '').toLowerCase()
    const mon = MONTH_NUM[rawMon] ?? MONTH_NUM[rawMon.slice(0, 3)]
    if (!mon) continue
    out.push({
      date: `${m[3]}-${mon}-${m[2]!.padStart(2, '0')}`,
      name,
      source: name === 'CPI' ? 'bls.gov CPI release schedule' : 'bls.gov Employment Situation schedule',
    })
  }
  return uniqueEvents(out)
}

export function eventsInWindow(
  events: MacroEventSnap[],
  windowStart: string,
  windowEnd: string,
): MacroEventSnap[] {
  return events.filter((e) => e.date >= windowStart && e.date <= windowEnd)
}

function uniqueEvents(events: MacroEventSnap[]): MacroEventSnap[] {
  const seen = new Set<string>()
  const out: MacroEventSnap[] = []
  for (const e of events) {
    const k = `${e.date}|${e.name}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}

export function parseTreasuryRealYield10y(xml: unknown): { date: string; yieldPct: number } | null {
  if (!xml || typeof xml !== 'object') return null
  const root = xml as Record<string, unknown>
  const feed = (root.feed ?? xml) as Record<string, unknown>
  const entries = feed.entry
  const list = Array.isArray(entries) ? entries : entries ? [entries] : []
  let best: { date: string; yieldPct: number } | null = null
  for (const entry of list) {
    const content =
      entry && typeof entry === 'object'
        ? ((entry as { content?: { properties?: unknown } }).content?.properties ??
          (entry as { properties?: unknown }).properties ??
          entry)
        : null
    const hit = findYieldField(content)
    if (hit && (!best || hit.date > best.date)) best = hit
  }
  return best
}
