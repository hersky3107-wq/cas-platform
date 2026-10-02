/**
 * Monthly-refresh seed: KRX popularity universe from 20-day average trading value.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/league/kr-universe-snapshot.ts
 *
 * Writes scripts/league/out/kr-universe-YYYYMMDD.csv (gitignored).
 * Does not create DB tables or register generate-path instruments.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KRX_STO_BASE = 'https://data-dbg.krx.co.kr/svc/apis/sto'
const DELAY_MS = 350
const TARGET_DATES = 20
const LOOKBACK_CALENDAR_DAYS = 40
const KEEP_PER_MARKET = 220
const NEW_LISTING_DAYS = 30
const EOK = 100_000_000
/** Minimum market cap (억원) on the latest session before ranking. Override: --min-mktcap=<eok> */
export const KR_MIN_MKTCAP_EOK = 3000

const TRADE = {
  KOSPI: '/stk_bydd_trd',
  KOSDAQ: '/ksq_bydd_trd',
} as const

const BASE_INFO = {
  KOSPI: '/stk_isu_base_info',
  KOSDAQ: '/ksq_isu_base_info',
} as const

type Market = 'KOSPI' | 'KOSDAQ'
type KrxRow = Record<string, string>

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function kstYmd(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')!.value
  const m = parts.find((p) => p.type === 'month')!.value
  const day = parts.find((p) => p.type === 'day')!.value
  return `${y}${m}${day}`
}

function addCalendarDaysYmd(ymd: string, delta: number): string {
  const y = Number(ymd.slice(0, 4))
  const m = Number(ymd.slice(4, 6))
  const d = Number(ymd.slice(6, 8))
  const utc = Date.UTC(y, m - 1, d + delta, 3, 0, 0)
  return kstYmd(new Date(utc))
}

function parseYmdToUtcMs(ymd: string): number | null {
  const raw = ymd.replace(/-/g, '').trim()
  if (!/^\d{8}$/.test(raw)) return null
  return Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8)), 3, 0, 0)
}

function parseNum(s: string | number | undefined | null): number | null {
  if (s == null) return null
  const n = Number(String(s).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

function extractRows(json: unknown): KrxRow[] {
  if (!json || typeof json !== 'object') return []
  const rec = json as Record<string, unknown>
  if (Array.isArray(rec.OutBlock_1)) return rec.OutBlock_1 as KrxRow[]
  if (Array.isArray(rec.outBlock_1)) return rec.outBlock_1 as KrxRow[]
  return []
}

async function krxPost(endpoint: string, basDd: string): Promise<{ http: number; rows: KrxRow[] }> {
  const key = process.env.KRX_API_KEY?.trim()
  if (!key) throw new Error('KRX_API_KEY not set')
  const headers = {
    AUTH_KEY: key,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  const url = `${KRX_STO_BASE}${endpoint}`

  const once = async (): Promise<{ http: number; rows: KrxRow[] }> => {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ basDd }) })
    const raw = await res.text()
    let json: unknown = null
    try {
      json = raw ? JSON.parse(raw) : null
    } catch {
      json = null
    }
    return { http: res.status, rows: extractRows(json) }
  }

  let result = await once()
  if (result.http >= 500 && result.http < 600) {
    await sleep(DELAY_MS)
    result = await once()
  }
  await sleep(DELAY_MS)
  return result
}

/** Prefer 6-char short code; fall back to ISIN KR?XXXXXX??? → XXXXXX. */
function sixDigitCode(row: KrxRow): { code: string; via: 'ISU_SRT_CD' | 'ISU_CD' | 'ISIN' } | null {
  const srt = String(row.ISU_SRT_CD ?? row.isuSrtCd ?? '').trim().toUpperCase()
  if (/^[0-9A-Z]{6}$/.test(srt)) return { code: srt, via: 'ISU_SRT_CD' }
  const cd = String(row.ISU_CD ?? row.isuCd ?? '').trim().toUpperCase()
  if (/^[0-9A-Z]{6}$/.test(cd)) return { code: cd, via: 'ISU_CD' }
  if (/^KR[0-9A-Z][0-9A-Z]{6}[0-9A-Z]{3}$/.test(cd)) return { code: cd.slice(3, 9), via: 'ISIN' }
  return null
}

function rowName(row: KrxRow): string {
  return String(row.ISU_ABBRV ?? row.ISU_NM ?? row.isuAbbrv ?? row.isuNm ?? '').trim()
}

function csvCell(value: string | number): string {
  const s = String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

type FilterCounts = {
  latestTrade: number
  joined: number
  afterSecugrp: number
  afterKind: number
  afterNameBan: number
  afterListAge: number
  afterHalt: number
  mktcapFloorRemoved: number
  afterMktcapFloor: number
  afterTop: number
}

type RankedRow = {
  market: Market
  rank: number
  code: string
  name: string
  avgTrdval: number
  mktcap: number
  listDd: string
}

function parseSnapshotArgs(argv: string[]): { minMktcapEok: number } {
  let minMktcapEok = KR_MIN_MKTCAP_EOK
  for (const arg of argv) {
    const m = arg.match(/^--min-mktcap=(\d+)$/)
    if (m) minMktcapEok = Number(m[1])
  }
  return { minMktcapEok }
}

function filterAndRank(
  market: Market,
  latestTrades: KrxRow[],
  tradesByDate: Map<string, KrxRow[]>,
  dates: string[],
  baseRows: KrxRow[],
  latestYmd: string,
  joinVia: { trade: Record<string, number>; base: Record<string, number> },
  minMktcapEok: number,
): { ranked: RankedRow[]; counts: FilterCounts; secugrp: Map<string, number>; keptSecugrp: Set<string> } {
  const baseByCode = new Map<string, { row: KrxRow; via: string }>()
  for (const row of baseRows) {
    const parsed = sixDigitCode(row)
    if (!parsed) continue
    joinVia.base[parsed.via] = (joinVia.base[parsed.via] ?? 0) + 1
    if (!baseByCode.has(parsed.code)) baseByCode.set(parsed.code, { row, via: parsed.via })
  }

  const latestByCode = new Map<string, { row: KrxRow; via: string }>()
  for (const row of latestTrades) {
    const parsed = sixDigitCode(row)
    if (!parsed) continue
    joinVia.trade[parsed.via] = (joinVia.trade[parsed.via] ?? 0) + 1
    latestByCode.set(parsed.code, { row, via: parsed.via })
  }

  const trdvalByCodeDate = new Map<string, Map<string, number>>()
  for (const date of dates) {
    for (const row of tradesByDate.get(date) ?? []) {
      const parsed = sixDigitCode(row)
      if (!parsed) continue
      const val = parseNum(row.ACC_TRDVAL) ?? 0
      if (!trdvalByCodeDate.has(parsed.code)) trdvalByCodeDate.set(parsed.code, new Map())
      trdvalByCodeDate.get(parsed.code)!.set(date, val)
    }
  }

  const cutoffMs = parseYmdToUtcMs(addCalendarDaysYmd(latestYmd, -NEW_LISTING_DAYS))
  const secugrp = new Map<string, number>()
  const keptSecugrp = new Set<string>()
  const counts: FilterCounts = {
    latestTrade: latestTrades.length,
    joined: 0,
    afterSecugrp: 0,
    afterKind: 0,
    afterNameBan: 0,
    afterListAge: 0,
    afterHalt: 0,
    mktcapFloorRemoved: 0,
    afterMktcapFloor: 0,
    afterTop: 0,
  }

  const passed: Array<Omit<RankedRow, 'rank'>> = []

  for (const [code, trade] of latestByCode) {
    const base = baseByCode.get(code)
    if (!base) continue
    counts.joined += 1

    const grp = String(base.row.SECUGRP_NM ?? '').trim()
    secugrp.set(grp, (secugrp.get(grp) ?? 0) + 1)
    if (!grp.includes('주권')) continue
    keptSecugrp.add(grp)
    counts.afterSecugrp += 1

    const kind = String(base.row.KIND_STKCERT_TP_NM ?? '').trim()
    if (kind !== '보통주') continue
    counts.afterKind += 1

    const name = rowName(base.row) || rowName(trade.row) || code
    if (name.includes('스팩') || name.includes('리츠')) continue
    counts.afterNameBan += 1

    const listDdRaw = String(base.row.LIST_DD ?? '').replace(/-/g, '').trim()
    const listMs = parseYmdToUtcMs(listDdRaw)
    if (listMs != null && cutoffMs != null && listMs > cutoffMs) continue
    counts.afterListAge += 1

    const latestVal = parseNum(trade.row.ACC_TRDVAL)
    if (latestVal == null || latestVal === 0) continue
    counts.afterHalt += 1

    const mktcap = parseNum(trade.row.MKTCAP) ?? 0
    const mktcapEok = Math.round(mktcap / EOK)
    if (mktcapEok < minMktcapEok) {
      counts.mktcapFloorRemoved += 1
      continue
    }
    counts.afterMktcapFloor += 1

    const byDate = trdvalByCodeDate.get(code)
    let sum = 0
    for (const date of dates) sum += byDate?.get(date) ?? 0
    const avgTrdval = sum / dates.length

    passed.push({
      market,
      code,
      name,
      avgTrdval,
      mktcap,
      listDd: listDdRaw || '',
    })
  }

  passed.sort((a, b) => b.avgTrdval - a.avgTrdval || b.mktcap - a.mktcap)
  const ranked = passed.slice(0, KEEP_PER_MARKET).map((row, i) => ({ ...row, rank: i + 1 }))
  counts.afterTop = ranked.length
  return { ranked, counts, secugrp, keptSecugrp }
}

function printMarketSummary(
  market: Market,
  counts: FilterCounts,
  ranked: RankedRow[],
  secugrp: Map<string, number>,
  keptSecugrp: Set<string>,
) {
  console.log(`\n--- ${market} filters ---`)
  console.log(`  latest trade rows:          ${counts.latestTrade}`)
  console.log(`  joined to base info:        ${counts.joined}`)
  console.log(`  after SECUGRP_NM 주권:      ${counts.afterSecugrp}`)
  console.log(`  after KIND_STKCERT_TP_NM=보통주: ${counts.afterKind}`)
  console.log(`  after name ban (스팩/리츠): ${counts.afterNameBan}`)
  console.log(`  after LIST_DD >= 30d:       ${counts.afterListAge}`)
  console.log(`  after ACC_TRDVAL≠0 latest:  ${counts.afterHalt}`)
  console.log(`  removed mktcap floor:       ${counts.mktcapFloorRemoved}`)
  console.log(`  after mktcap floor:         ${counts.afterMktcapFloor}`)
  console.log(`  after top ${KEEP_PER_MARKET}:              ${counts.afterTop}`)
  console.log(`  SECUGRP_NM seen (joined):`)
  for (const [name, n] of [...secugrp.entries()].sort((a, b) => b[1] - a[1])) {
    const keep = keptSecugrp.has(name) ? 'KEEP' : 'drop'
    console.log(`    ${keep.padEnd(4)}  ${n.toString().padStart(4)}  ${name || '(empty)'}`)
  }
  console.log(`  top 10 by 20d avg trading value:`)
  for (const row of ranked.slice(0, 10)) {
    console.log(
      `    ${String(row.rank).padStart(2)}. ${row.code}  ${row.name}  ${Math.round(row.avgTrdval / EOK)}억  mktcap=${Math.round(row.mktcap / EOK)}억`,
    )
  }
}

async function collectTradingDates(): Promise<{
  dates: string[]
  kospi: Map<string, KrxRow[]>
  kosdaq: Map<string, KrxRow[]>
}> {
  const today = kstYmd()
  const start = addCalendarDaysYmd(today, -1)
  const dates: string[] = []
  const kospi = new Map<string, KrxRow[]>()
  const kosdaq = new Map<string, KrxRow[]>()

  console.log(`Walk back from yesterday KST ${start}, collect ${TARGET_DATES} non-empty sessions (cap ${LOOKBACK_CALENDAR_DAYS} calendar days).`)

  for (let i = 0; i < LOOKBACK_CALENDAR_DAYS && dates.length < TARGET_DATES; i++) {
    const basDd = addCalendarDaysYmd(start, -i)
    const kp = await krxPost(TRADE.KOSPI, basDd)
    if (kp.rows.length === 0) {
      console.log(`  ${basDd} KOSPI empty (holiday/weekend) HTTP ${kp.http} — skip`)
      continue
    }
    const kq = await krxPost(TRADE.KOSDAQ, basDd)
    if (kq.rows.length === 0) {
      console.log(`  ${basDd} KOSDAQ empty after KOSPI ${kp.rows.length} rows HTTP ${kq.http} — skip`)
      continue
    }
    dates.push(basDd)
    kospi.set(basDd, kp.rows)
    kosdaq.set(basDd, kq.rows)
    console.log(`  ${basDd} session ${dates.length}/${TARGET_DATES}  KOSPI=${kp.rows.length}  KOSDAQ=${kq.rows.length}`)
  }

  if (dates.length === 0) throw new Error('No non-empty KRX sessions in lookback window')
  return { dates, kospi, kosdaq }
}

async function main() {
  if (!process.env.KRX_API_KEY?.trim()) throw new Error('KRX_API_KEY not set')
  const { minMktcapEok } = parseSnapshotArgs(process.argv.slice(2))
  console.log(`Market-cap floor: ${minMktcapEok}억 (latest session MKTCAP)`)

  const { dates, kospi, kosdaq } = await collectTradingDates()
  const latest = dates[0]!
  console.log(`\nDates used (${dates.length}): ${dates.join(', ')}`)
  console.log(`Most recent session: ${latest} — fetching base info`)

  const kospiBase = await krxPost(BASE_INFO.KOSPI, latest)
  const kosdaqBase = await krxPost(BASE_INFO.KOSDAQ, latest)
  console.log(`  stk_isu_base_info rows=${kospiBase.rows.length} HTTP ${kospiBase.http}`)
  console.log(`  ksq_isu_base_info rows=${kosdaqBase.rows.length} HTTP ${kosdaqBase.http}`)

  const joinVia = {
    kospi: { trade: {} as Record<string, number>, base: {} as Record<string, number> },
    kosdaq: { trade: {} as Record<string, number>, base: {} as Record<string, number> },
  }

  const kp = filterAndRank(
    'KOSPI',
    kospi.get(latest) ?? [],
    kospi,
    dates,
    kospiBase.rows,
    latest,
    joinVia.kospi,
    minMktcapEok,
  )
  const kq = filterAndRank(
    'KOSDAQ',
    kosdaq.get(latest) ?? [],
    kosdaq,
    dates,
    kosdaqBase.rows,
    latest,
    joinVia.kosdaq,
    minMktcapEok,
  )

  console.log('\n--- Join key ---')
  console.log(
    '  6-digit code: ISU_SRT_CD if it is 6 [0-9A-Z], else ISU_CD if it is 6 [0-9A-Z], else KR ISIN slice(3,9).',
  )
  console.log(`  KOSPI trade via: ${JSON.stringify(joinVia.kospi.trade)}`)
  console.log(`  KOSPI base  via: ${JSON.stringify(joinVia.kospi.base)}`)
  console.log(`  KOSDAQ trade via: ${JSON.stringify(joinVia.kosdaq.trade)}`)
  console.log(`  KOSDAQ base  via: ${JSON.stringify(joinVia.kosdaq.base)}`)

  printMarketSummary('KOSPI', kp.counts, kp.ranked, kp.secugrp, kp.keptSecugrp)
  printMarketSummary('KOSDAQ', kq.counts, kq.ranked, kq.secugrp, kq.keptSecugrp)

  const lines = ['market,rank,code,name,avg_trdval_20d_eok,mktcap_eok,list_dd']
  for (const row of [...kp.ranked, ...kq.ranked]) {
    lines.push(
      [
        csvCell(row.market),
        csvCell(row.rank),
        csvCell(row.code),
        csvCell(row.name),
        csvCell(Math.round(row.avgTrdval / EOK)),
        csvCell(Math.round(row.mktcap / EOK)),
        csvCell(row.listDd),
      ].join(','),
    )
  }

  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `kr-universe-${latest}.csv`)
  writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8')
  console.log(`\nCSV: ${outPath}  (${kp.ranked.length + kq.ranked.length} rows)`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
