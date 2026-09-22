import { splitCsvLine } from './metals-parse'

/**
 * Pure parsers for commodities_energy packet feeds. No fetches — unit tests
 * never import `server-only`. EIA WPSR table1.csv + WNGSR JSON.
 */

export type EiaCrudeParsed = {
  weekEnding: string
  commercialStocksMMbbl: number
  commercialWowChangeMMbbl: number
  sprMMbbl: number
  productionKbpd: number
  refineryRunsKbpd: number
  productSuppliedKbpd: number
}

export type EiaNatgasParsed = {
  weekEnding: string
  storageBcf: number
  netChangeBcf: number
  vs5yrAvgPct: number
  vsYearAgoPct: number
  fiveYearAvgBcf: number
}

function parseEiaNumber(raw: string | undefined): number | null {
  if (raw == null) return null
  const cleaned = raw.replace(/,/g, '').replace(/[^\d.+-]/g, '').trim()
  if (!cleaned || cleaned === '.' || cleaned === '-' || cleaned === '+') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** EIA WPSR dates are M/D/YY in the header (e.g. 9/11/26). */
export function parseEiaHeaderDate(raw: string): string | null {
  const trimmed = raw.replace(/"/g, '').trim()
  const mdY = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (mdY) {
    const year = Number(mdY[3])
    const full = year >= 70 ? 1900 + year : 2000 + year
    return `${full}-${mdY[1]!.padStart(2, '0')}-${mdY[2]!.padStart(2, '0')}`
  }
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

function stubNorm(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * EIA Weekly Petroleum Status Report Table 1 (`ir.eia.gov/wpsr/table1.csv`).
 * Two concatenated tables: stocks (million bbl) then supply (thousand b/d).
 */
export function parseEiaWpsrTable1(csv: string): EiaCrudeParsed | null {
  const lines = csv.split(/\r?\n/).map((l) => l.replace(/^\uFEFF/, '').replace(/\u001a/g, '').trim()).filter(Boolean)
  let stocksDate: string | null = null
  let commercial: { current: number; wow: number } | null = null
  let spr: number | null = null
  let production: number | null = null
  let refineryRuns: number | null = null
  let productSupplied: number | null = null
  let mode: 'none' | 'stocks' | 'supply' = 'none'

  for (const line of lines) {
    const cols = splitCsvLine(line)
    const c0 = stubNorm(cols[0] ?? '')
    const c1 = stubNorm(cols[1] ?? '')
    if (/^STUB_1$/i.test(c0) && /^STUB_2$/i.test(c1)) {
      mode = 'supply'
      stocksDate = parseEiaHeaderDate(cols[2] ?? '') ?? stocksDate
      continue
    }
    if (/^STUB_1$/i.test(c0) && !/^STUB_2$/i.test(c1)) {
      mode = 'stocks'
      stocksDate = parseEiaHeaderDate(cols[1] ?? '') ?? stocksDate
      continue
    }
    if (mode === 'stocks') {
      if (/Commercial \(Excluding SPR\)/i.test(c0)) {
        const current = parseEiaNumber(cols[1])
        const prior = parseEiaNumber(cols[2])
        const diff = parseEiaNumber(cols[3])
        if (current != null) {
          commercial = {
            current,
            wow: diff ?? (prior != null ? current - prior : 0),
          }
        }
      } else if (/Strategic Petroleum Reserve/i.test(c0)) {
        spr = parseEiaNumber(cols[1])
      }
    } else if (mode === 'supply') {
      if (/\(1\)\s*Domestic Production/i.test(c1)) {
        production = parseEiaNumber(cols[2])
      } else if (/Crude Oil Input to Refineries/i.test(c1)) {
        refineryRuns = parseEiaNumber(cols[2])
      } else if (/^Products Supplied/i.test(c0) && /\(30\)\s*Total/i.test(c1)) {
        productSupplied = parseEiaNumber(cols[2])
      }
    }
  }

  if (
    !stocksDate ||
    commercial == null ||
    spr == null ||
    production == null ||
    refineryRuns == null ||
    productSupplied == null
  ) {
    return null
  }
  return {
    weekEnding: stocksDate,
    commercialStocksMMbbl: commercial.current,
    commercialWowChangeMMbbl: commercial.wow,
    sprMMbbl: spr,
    productionKbpd: production,
    refineryRunsKbpd: refineryRuns,
    productSuppliedKbpd: productSupplied,
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

function numField(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const n = Number(obj[k])
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * EIA Weekly Natural Gas Storage Report (`ir.eia.gov/ngs/wngsr.json`).
 * Uses the Lower 48 working-gas series.
 */
export function parseEiaWngsr(json: unknown): EiaNatgasParsed | null {
  const root = asRecord(json)
  if (!root) return null
  const series = root.series
  const list = Array.isArray(series) ? series : series ? [series] : []
  const lower48 = list.find((s) => {
    const rec = asRecord(s)
    if (!rec) return false
    const name = String(rec.name ?? '').toLowerCase()
    const id = String(rec.series_id ?? '').toLowerCase()
    return name.includes('total lower 48') || /_r48_/.test(id)
  })
  const rec = asRecord(lower48)
  if (!rec) return null
  const calc = asRecord(rec.calculated) ?? {}
  const data = Array.isArray(rec.data) ? rec.data : []
  const latest = Array.isArray(data[0]) ? data[0] : null
  const storage = latest != null ? Number(latest[1]) : NaN
  const weekFromData = latest != null && typeof latest[0] === 'string' ? parseEiaHeaderDate(latest[0]) ?? latest[0] : null
  const weekEnding =
    (typeof root.current_week === 'string' ? parseEiaHeaderDate(root.current_week) ?? root.current_week : null) ??
    weekFromData
  const netChange = numField(calc, 'net_change', 'netChange')
  const vs5yr = numField(calc, 'pct-chg_5yr-avg', 'pct_chg_5yr_avg')
  const vsYear = numField(calc, 'pct-change_yrago', 'pct_change_yrago')
  const fiveYearAvg = numField(calc, '5yr-avg', 'five_yr_avg')
  if (
    !weekEnding ||
    !Number.isFinite(storage) ||
    netChange == null ||
    vs5yr == null ||
    vsYear == null ||
    fiveYearAvg == null
  ) {
    return null
  }
  return {
    weekEnding,
    storageBcf: storage,
    netChangeBcf: netChange,
    vs5yrAvgPct: vs5yr,
    vsYearAgoPct: vsYear,
    fiveYearAvgBcf: fiveYearAvg,
  }
}
