import type { CotPositioning } from './closed-book-packet'

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
