import 'server-only'

/**
 * Official KRX daily closes for KOSPI/KOSDAQ.
 * Never expose this module's raw data to client components or API responses.
 * Emptiness is never cached (a 0-row trading day may publish later).
 */

import { supabaseAdmin } from '@/lib/supabase/server'
import {
  isKrxTradingDay,
  lastCompletedKrxSession,
  lastNKrxSessionDates,
} from '@/lib/league/krx-calendar'

const TABLE = 'league_krx_daily'
const KRX_STO_BASE = 'https://data-dbg.krx.co.kr/svc/apis/sto'
const DELAY_MS = 250

const TRADE = {
  KOSPI: '/stk_bydd_trd',
  KOSDAQ: '/ksq_bydd_trd',
} as const

export type KrxMarket = 'KOSPI' | 'KOSDAQ'

export type KrxDailyBar = {
  date: string
  market: KrxMarket
  code: string
  name: string | null
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number | null
  trdval: number | null
  mktcap: number | null
}

export type KrxCloseBar = {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number | null
}

export type EnsureKrxDayResult = 'cached' | 'ok' | 'holiday' | 'not_published'
export type OfficialCloseResult = number | 'not_published' | 'holiday' | 'unknown_code'

export type KrxCloseSeriesResult = {
  series: KrxCloseBar[]
  notPublished: string[]
  unverified: boolean
}

export type KrxDailyIo = {
  fetchDay: (compactBasDd: string) => Promise<KrxDailyBar[]>
  marketsPresent: (isoDate: string) => Promise<{ KOSPI: boolean; KOSDAQ: boolean }>
  upsertRows: (rows: KrxDailyBar[]) => Promise<void>
  getRow: (market: KrxMarket, code: string, isoDate: string) => Promise<KrxDailyBar | null>
  /** One read for many session dates. Missing dates are not an error. */
  listCodeRows: (market: KrxMarket, code: string, isoDates: readonly string[]) => Promise<KrxDailyBar[]>
  now: () => Date
}

export function parseKrxNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

export function toCompactBasDd(isoOrCompact: string): string {
  const digits = isoOrCompact.replace(/-/g, '').trim()
  if (!/^\d{8}$/.test(digits)) {
    throw new Error(`invalid KRX basDd: ${isoOrCompact}`)
  }
  return digits
}

export function toIsoBasDd(isoOrCompact: string): string {
  const compact = toCompactBasDd(isoOrCompact)
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
}

function sixDigitCode(row: Record<string, unknown>): string | null {
  const srt = String(row.ISU_SRT_CD ?? row.isuSrtCd ?? '').trim().toUpperCase()
  if (/^[0-9A-Z]{6}$/.test(srt)) return srt
  const cd = String(row.ISU_CD ?? row.isuCd ?? '').trim().toUpperCase()
  if (/^[0-9A-Z]{6}$/.test(cd)) return cd
  if (/^KR[0-9A-Z][0-9A-Z]{6}[0-9A-Z]{3}$/.test(cd)) return cd.slice(3, 9)
  return null
}

export function mapKrxTradeRow(
  market: KrxMarket,
  row: Record<string, unknown>,
  isoDate: string,
): KrxDailyBar | null {
  const code = sixDigitCode(row)
  const close = parseKrxNumber(row.TDD_CLSPRC ?? row.tddClsprc)
  if (!code || close == null) return null
  const nameRaw = String(row.ISU_NM ?? row.isuNm ?? '').trim()
  return {
    date: isoDate,
    market,
    code,
    name: nameRaw || null,
    open: parseKrxNumber(row.TDD_OPNPRC ?? row.tddOpnprc),
    high: parseKrxNumber(row.TDD_HGPRC ?? row.tddHgprc),
    low: parseKrxNumber(row.TDD_LWPRC ?? row.tddLwprc),
    close,
    volume: parseKrxNumber(row.ACC_TRDVOL ?? row.accTrdvol),
    trdval: parseKrxNumber(row.ACC_TRDVAL ?? row.accTrdval),
    mktcap: parseKrxNumber(row.MKTCAP ?? row.mktcap),
  }
}

export function extractKrxRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== 'object') return []
  const rec = json as Record<string, unknown>
  if (Array.isArray(rec.OutBlock_1)) return rec.OutBlock_1 as Record<string, unknown>[]
  if (Array.isArray(rec.outBlock_1)) return rec.outBlock_1 as Record<string, unknown>[]
  return []
}

export function emptyKrxFetchOutcome(isoDate: string): 'holiday' | 'not_published' {
  return isKrxTradingDay(isoDate) ? 'not_published' : 'holiday'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postKrxMarket(market: KrxMarket, compactBasDd: string): Promise<KrxDailyBar[]> {
  const key = process.env.KRX_API_KEY?.trim()
  if (!key) throw new Error('KRX_API_KEY not set')
  const isoDate = toIsoBasDd(compactBasDd)
  const headers = {
    AUTH_KEY: key,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  const url = `${KRX_STO_BASE}${TRADE[market]}`

  const once = async (): Promise<{ http: number; rows: KrxDailyBar[] }> => {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ basDd: compactBasDd }),
    })
    const raw = await res.text()
    let json: unknown = null
    try {
      json = raw ? JSON.parse(raw) : null
    } catch {
      json = null
    }
    const rows = extractKrxRows(json)
      .map((row) => mapKrxTradeRow(market, row, isoDate))
      .filter((row): row is KrxDailyBar => row !== null)
    return { http: res.status, rows }
  }

  let result = await once()
  if (result.http >= 500 && result.http < 600) {
    await sleep(DELAY_MS)
    result = await once()
  }
  if (result.http >= 500) {
    throw new Error(`KRX ${market} ${compactBasDd}: HTTP ${result.http}`)
  }
  return result.rows
}

export async function fetchKrxDay(basDd: string): Promise<KrxDailyBar[]> {
  const compact = toCompactBasDd(basDd)
  const kospi = await postKrxMarket('KOSPI', compact)
  const kosdaq = await postKrxMarket('KOSDAQ', compact)
  return [...kospi, ...kosdaq]
}

function toDbRow(row: KrxDailyBar) {
  return {
    bas_dd: row.date,
    market: row.market,
    code: row.code,
    name: row.name,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    trdval: row.trdval,
    mktcap: row.mktcap,
  }
}

async function defaultMarketsPresent(isoDate: string): Promise<{ KOSPI: boolean; KOSDAQ: boolean }> {
  const { data, error } = await supabaseAdmin.from(TABLE).select('market').eq('bas_dd', isoDate)
  if (error) throw new Error(`league_krx_daily marketsPresent: ${error.message}`)
  const present = { KOSPI: false, KOSDAQ: false }
  for (const row of data ?? []) {
    if (row.market === 'KOSPI') present.KOSPI = true
    if (row.market === 'KOSDAQ') present.KOSDAQ = true
  }
  return present
}

async function defaultUpsertRows(rows: KrxDailyBar[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabaseAdmin.from(TABLE).upsert(rows.map(toDbRow), {
    onConflict: 'bas_dd,market,code',
  })
  if (error) throw new Error(`league_krx_daily upsert: ${error.message}`)
}

function barFromDailyRow(data: {
  bas_dd: unknown
  market: unknown
  code: unknown
  name: unknown
  open: unknown
  high: unknown
  low: unknown
  close: unknown
  volume: unknown
  trdval: unknown
  mktcap: unknown
}): KrxDailyBar | null {
  if (data.close == null) return null
  const market = data.market === 'KOSDAQ' ? 'KOSDAQ' : data.market === 'KOSPI' ? 'KOSPI' : null
  if (!market) return null
  return {
    date: String(data.bas_dd).slice(0, 10),
    market,
    code: String(data.code),
    name: data.name != null ? String(data.name) : null,
    open: data.open == null ? null : Number(data.open),
    high: data.high == null ? null : Number(data.high),
    low: data.low == null ? null : Number(data.low),
    close: Number(data.close),
    volume: data.volume == null ? null : Number(data.volume),
    trdval: data.trdval == null ? null : Number(data.trdval),
    mktcap: data.mktcap == null ? null : Number(data.mktcap),
  }
}

const DAILY_COLUMNS = 'bas_dd, market, code, name, open, high, low, close, volume, trdval, mktcap'

async function defaultGetRow(
  market: KrxMarket,
  code: string,
  isoDate: string,
): Promise<KrxDailyBar | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(DAILY_COLUMNS)
    .eq('bas_dd', isoDate)
    .eq('market', market)
    .eq('code', code)
    .maybeSingle()
  if (error) throw new Error(`league_krx_daily getRow: ${error.message}`)
  if (!data) return null
  return barFromDailyRow(data)
}

async function defaultListCodeRows(
  market: KrxMarket,
  code: string,
  isoDates: readonly string[],
): Promise<KrxDailyBar[]> {
  if (isoDates.length === 0) return []
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(DAILY_COLUMNS)
    .eq('market', market)
    .eq('code', code)
    .in('bas_dd', [...isoDates])
  if (error) throw new Error(`league_krx_daily listCodeRows: ${error.message}`)
  const bars: KrxDailyBar[] = []
  for (const row of data ?? []) {
    const bar = barFromDailyRow(row)
    if (bar) bars.push(bar)
  }
  return bars
}

function resolveIo(io?: Partial<KrxDailyIo>): KrxDailyIo {
  return {
    fetchDay: io?.fetchDay ?? fetchKrxDay,
    marketsPresent: io?.marketsPresent ?? defaultMarketsPresent,
    upsertRows: io?.upsertRows ?? defaultUpsertRows,
    getRow: io?.getRow ?? defaultGetRow,
    listCodeRows: io?.listCodeRows ?? defaultListCodeRows,
    now: io?.now ?? (() => new Date()),
  }
}

export async function ensureKrxDay(
  basDd: string,
  io?: Partial<KrxDailyIo>,
): Promise<EnsureKrxDayResult> {
  const deps = resolveIo(io)
  const isoDate = toIsoBasDd(basDd)
  if (!isKrxTradingDay(isoDate)) return 'holiday'
  const present = await deps.marketsPresent(isoDate)
  if (present.KOSPI && present.KOSDAQ) return 'cached'
  const rows = await deps.fetchDay(toCompactBasDd(isoDate))
  if (rows.length === 0) {
    return emptyKrxFetchOutcome(isoDate)
  }
  await deps.upsertRows(rows)
  return 'ok'
}

export async function getOfficialClose(
  market: KrxMarket,
  code: string,
  basDd: string,
  io?: Partial<KrxDailyIo>,
): Promise<OfficialCloseResult> {
  const deps = resolveIo(io)
  const isoDate = toIsoBasDd(basDd)
  if (!isKrxTradingDay(isoDate)) return 'holiday'
  const ensured = await ensureKrxDay(isoDate, deps)
  if (ensured === 'holiday') return 'holiday'
  if (ensured === 'not_published') return 'not_published'
  const row = await deps.getRow(market, code, isoDate)
  if (!row) return 'unknown_code'
  return row.close
}

export async function getKrxCloseSeries(
  market: KrxMarket,
  code: string,
  sessions: number,
  io?: Partial<KrxDailyIo>,
): Promise<KrxCloseSeriesResult> {
  const deps = resolveIo(io)
  const last = lastCompletedKrxSession(deps.now())
  if (!last.ok) {
    return { series: [], notPublished: [], unverified: true }
  }
  const dates = lastNKrxSessionDates(last.date, sessions)
  const tradingDates = dates.filter((date) => isKrxTradingDay(date))
  const cached = await deps.listCodeRows(market, code, tradingDates)
  const byDate = new Map(cached.map((row) => [row.date, row]))
  const series: KrxCloseBar[] = []
  const notPublished: string[] = []
  for (const date of tradingDates) {
    let row = byDate.get(date) ?? null
    if (!row) {
      const ensured = await ensureKrxDay(date, deps)
      if (ensured === 'not_published') {
        notPublished.push(date)
        continue
      }
      if (ensured === 'holiday') continue
      row = await deps.getRow(market, code, date)
    }
    if (!row) continue
    series.push({
      date: row.date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    })
  }
  return { series, notPublished, unverified: false }
}

function nextIsoDate(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)
}

/**
 * Official KRX daily closes in [startIso, endIso], oldest→newest.
 * Unpublished trading days are omitted (never empty-cached).
 */
export async function getOfficialClosesBetween(
  market: KrxMarket,
  code: string,
  startIso: string,
  endIso: string,
  io?: Partial<KrxDailyIo>,
): Promise<{ sessionDate: string; close: number }[]> {
  const deps = resolveIo(io)
  const bars: { sessionDate: string; close: number }[] = []
  for (let date = startIso.slice(0, 10); date <= endIso.slice(0, 10); date = nextIsoDate(date)) {
    if (!isKrxTradingDay(date)) continue
    const ensured = await ensureKrxDay(date, deps)
    if (ensured === 'not_published' || ensured === 'holiday') continue
    const row = await deps.getRow(market, code, date)
    if (!row) continue
    bars.push({ sessionDate: row.date, close: row.close })
  }
  return bars
}
