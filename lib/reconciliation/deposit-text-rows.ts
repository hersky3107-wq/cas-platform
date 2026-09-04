/**
 * Deterministic multi-row extraction from pasted bank-alert / internet-banking
 * text. Pure — no AI, no I/O. Year is NEVER taken from "today": infer it from
 * other rows in the same capture, or leave the date null and mark
 * year_ambiguous so HITL can fill it in.
 */

const YMD_RE = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/g
const MD_RE = /(?<!\d)(\d{1,2})[.\-/](\d{1,2})(?!\d)/g
const AMOUNT_WON_RE = /(\d{1,3}(?:,\d{3})+|\d{3,})\s*원/g
const AMOUNT_COMMA_RE = /(\d{1,3}(?:,\d{3})+)/g

export type LineDate = {
  y: number | null
  m: number
  d: number
}

export type ExtractedDepositRow = {
  date: string | null
  amount: number
  memo: string | null
  year_ambiguous: boolean
  lineDate: LineDate | null
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatLineDate(d: LineDate): string | null {
  if (d.y == null) return null
  return `${d.y}-${pad(d.m)}-${pad(d.d)}`
}

export function parseLineDate(line: string): LineDate | null {
  YMD_RE.lastIndex = 0
  const ymd = YMD_RE.exec(line)
  if (ymd) {
    const m = Number(ymd[2])
    const d = Number(ymd[3])
    if (m < 1 || m > 12 || d < 1 || d > 31) return null
    return { y: Number(ymd[1]), m, d }
  }
  MD_RE.lastIndex = 0
  const md = MD_RE.exec(line)
  if (md) {
    const m = Number(md[1])
    const d = Number(md[2])
    if (m < 1 || m > 12 || d < 1 || d > 31) return null
    return { y: null, m, d }
  }
  return null
}

function normalizeAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

function pickAmount(line: string): { amount: number; raw: string } | null {
  AMOUNT_WON_RE.lastIndex = 0
  const won = [...line.matchAll(AMOUNT_WON_RE)]
  const candidates = won.length > 0 ? won : [...line.matchAll(AMOUNT_COMMA_RE)]
  for (const c of candidates) {
    const raw = c[1]!
    if (/^20\d{2}$/.test(raw.replace(/,/g, ''))) continue
    const amount = normalizeAmount(raw)
    if (amount != null && amount > 0) return { amount, raw }
  }
  return null
}

function stripMemo(line: string, amountRaw: string | null): string | null {
  let s = line
  s = s.replace(YMD_RE, ' ')
  s = s.replace(MD_RE, ' ')
  if (amountRaw) s = s.replace(amountRaw, ' ')
  s = s.replace(/\s*원/gi, ' ')
  s = s.replace(/입금|이체|완료|기준|received|deposit/gi, ' ')
  s = s.replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
  s = s.replace(/\[web발신\]/gi, ' ')
  s = s.replace(/\[[^\]]*(은행|bank)[^\]]*\]/gi, ' ')
  s = s.replace(/[()]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s.length ? s : null
}

export function applyYearInference<T extends { date: string | null; year_ambiguous: boolean; lineDate?: LineDate | null }>(
  rows: T[]
): T[] {
  const years = new Set<number>()
  for (const row of rows) {
    if (row.date && /^20\d{2}-\d{2}-\d{2}$/.test(row.date)) {
      years.add(Number(row.date.slice(0, 4)))
    } else if (row.lineDate?.y != null) {
      years.add(row.lineDate.y)
    }
  }
  const unique = [...years]
  return rows.map((row) => {
    if (row.date) return { ...row, year_ambiguous: false }
    const md = row.lineDate
    if (!md) return { ...row, date: null, year_ambiguous: true }
    if (unique.length === 1) {
      return {
        ...row,
        date: `${unique[0]}-${pad(md.m)}-${pad(md.d)}`,
        year_ambiguous: false,
      }
    }
    return { ...row, date: null, year_ambiguous: true }
  })
}

export function lowerConfidenceIfYearAmbiguous(confidence: number, yearAmbiguous: boolean): number {
  if (!yearAmbiguous) return confidence
  return Math.min(confidence, 0.4)
}

/**
 * One row per line that carries a deposit amount. Dates on a previous line
 * (classic SMS: date then amount) are reused. 잔액-only lines are skipped.
 */
export function extractDepositTextRows(text: string): ExtractedDepositRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const collected: Array<ExtractedDepositRow & { lineDate: LineDate | null }> = []
  let lastDate: LineDate | null = null

  for (const line of lines) {
    const lineDate = parseLineDate(line)
    if (lineDate) lastDate = lineDate

    const balanceOnly = /잔액|balance/i.test(line) && !/입금|이체|deposit|received/i.test(line)
    if (balanceOnly) continue

    const picked = pickAmount(line)
    if (!picked) continue

    const md = lineDate ?? lastDate
    collected.push({
      date: md ? formatLineDate(md) : null,
      amount: picked.amount,
      memo: stripMemo(line, picked.raw),
      year_ambiguous: md != null && md.y == null,
      lineDate: md,
    })
  }

  return applyYearInference(collected).map((row) => ({
    date: row.date,
    amount: row.amount,
    memo: row.memo,
    year_ambiguous: row.year_ambiguous,
    lineDate: row.lineDate,
  }))
}
