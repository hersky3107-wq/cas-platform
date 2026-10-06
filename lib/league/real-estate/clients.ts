/**
 * Official housing-index clients.
 *
 * Licenses, in short:
 * - FRED: St. Louis Fed API terms. Case-Shiller and FHFA series stay under
 *   their owners’ copyright. FRED_API_KEY is already the project key. Do not
 *   log it. Non-personal republication of a copyrighted series needs the
 *   owner’s permission; FRED does not grant that.
 * - UK HPI: HM Land Registry, Open Government Licence v3. No key.
 * - Korea: R-ONE Open API. Apply while logged in at
 *   https://www.reb.or.kr/r-one/portal/openapi/openApiActKeyPage.do
 *   and set RONE_API_KEY. data.go.kr service 15134761 points at the same API.
 *   Public-data use is free with no extra licence limit stated on that page.
 *   Without the key the API is a 5-row sample, which this client refuses.
 * - Japan: e-Stat getStatsList has no 不動産価格指数（住宅） table (MLIT survey
 *   codes under org 00600 stop at 住生活総合調査). The official file is the
 *   MLIT workbook linked from the 最新データ row, currently
 *   content/001473668.xlsx, NSA 住宅総合. ESTAT_HOUSING_STATS_DATA_ID still
 *   overrides that file when set. ESTAT_APP_ID is only required for the override.
 * - Australia: no client. ABS 6416.0 RPPI ceased after December quarter 2021.
 */

import ExcelJS from 'exceljs'
import type { PropertyRegion } from '../gateway/adapters/real-estate-regions'
import {
  catalogRegionForEstatArea,
  catalogRegionForRonePath,
  lastWeeklyRonePrints,
  mlitHousingWorkbookUrl,
  parseEstatHousing,
  parseFredObservations,
  parseMlitHousingRow,
  parseRoneTable,
  parseUkHpiCsv,
  redactHousingSecrets,
  type ParsedPoint,
  type RoneRow,
} from './parse'

const FHFA_FRED: Record<string, string> = {
  FHFA_CA: 'CASTHPI',
  FHFA_NY: 'NYSTHPI',
  FHFA_TX: 'TXSTHPI',
  FHFA_FL: 'FLSTHPI',
  FHFA_WA: 'WASTHPI',
  FHFA_IL: 'ILSTHPI',
}

/** NSA 20-city composite and the seasonally adjusted national print. Stored, not used to grade an NSA round. */
export const FRED_CONTEXT_SERIES = ['CSUSHPISA', 'SPCS20RSA'] as const

/** Publication lags the reference month by about two months. July 2026 was published 16 September 2026. */
export const UK_HPI_LAG_MONTHS = 2

export const UK_HPI_FILE = (yyyyMm: string) =>
  `https://publicdata.landregistry.gov.uk/market-trend-data/house-price-index-data/UK-HPI-full-file-${yyyyMm}.csv`

/** Newest published file first. Each file contains the full history. */
export function ukHpiCandidateStamps(now: Date, lagMonths = UK_HPI_LAG_MONTHS, attempts = 8): string[] {
  const stamps: string[] = []
  for (let step = 0; step < attempts; step++) {
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - lagMonths - step, 1))
    stamps.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return stamps
}

export const UK_HPI_PAGE = 'https://www.gov.uk/government/collections/uk-house-price-index-reports'
export const FRED_SERIES_PAGE = (id: string) => `https://fred.stlouisfed.org/series/${id}`
export const RONE_PORTAL = 'https://www.reb.or.kr/r-one/portal/main/indexPage.do'
export const ESTAT_PAGE = 'https://www.e-stat.go.jp/'

/** (월) 지역별 매매지수_아파트 — 전국 and 시도. */
export const RONE_MONTHLY_STATBL = 'A_2024_00178'
/** (월) 매매가격지수_아파트 — 시군구. Found via SttsApiTbl.do. */
export const RONE_SIGUNGU_STATBL = 'A_2024_00045'
/** (주) 매매가격지수. Used only when a 시군구 is absent from the monthly table. */
export const RONE_WEEKLY_STATBL = 'T244183132827305'
export const MLIT_HOUSING_PAGE = 'https://www.mlit.go.jp/totikensangyo/totikensangyo_tk5_000085.html'
export const MLIT_HOUSING_XLSX = 'https://www.mlit.go.jp/totikensangyo/content/001473668.xlsx'
export const MLIT_HOUSING_TITLE = '不動産価格指数（住宅）'
export const MLIT_HOUSING_FILE_ID = '001473668'
export const RONE_DATA_URL = 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do'
export const ESTAT_JSON = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData'
export const ESTAT_LIST = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList'

export type HousingFetchResult =
  | { ok: true; source: string; seriesId: string; sourceUrl: string; points: ParsedPoint[] }
  | { ok: false; error: string }

export function fredSeriesForRegion(region: Pick<PropertyRegion, 'country' | 'code' | 'tier'>): string | null {
  if (region.country !== 'US' || region.tier === 'zillow') return null
  if (region.tier === 'fhfa') return FHFA_FRED[region.code] ?? null
  return region.code
}

export function fredObservationsUrl(seriesId: string, apiKey: string): string {
  const url = new URL('https://api.stlouisfed.org/fred/series/observations')
  url.searchParams.set('series_id', seriesId)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('file_type', 'json')
  return url.toString()
}

export async function fetchFredSeries(
  seriesId: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<HousingFetchResult> {
  if (!apiKey?.trim()) return { ok: false, error: 'FRED_API_KEY missing' }
  const url = fredObservationsUrl(seriesId, apiKey.trim())
  try {
    const res = await fetchImpl(url)
    if (!res.ok) return { ok: false, error: `FRED ${seriesId} HTTP ${res.status}` }
    const body = await res.json()
    return {
      ok: true,
      source: 'FRED',
      seriesId,
      sourceUrl: FRED_SERIES_PAGE(seriesId),
      points: parseFredObservations(body, seriesId),
    }
  } catch (err) {
    return { ok: false, error: redactHousingSecrets(err instanceof Error ? err.message : 'FRED fetch failed') }
  }
}

export async function fetchUkHpi(
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<HousingFetchResult> {
  let lastError = 'UK HPI file not found'
  for (const stamp of ukHpiCandidateStamps(now)) {
    const url = UK_HPI_FILE(stamp)
    try {
      const res = await fetchImpl(url)
      if (!res.ok) {
        lastError = `UK HPI ${stamp} HTTP ${res.status}`
        continue
      }
      const csv = await res.text()
      const points = parseUkHpiCsv(csv)
      if (points.length === 0) {
        lastError = `UK HPI ${stamp} had no index rows`
        continue
      }
      return { ok: true, source: 'UK HPI', seriesId: 'UK-HPI', sourceUrl: UK_HPI_PAGE, points }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'UK HPI fetch failed'
    }
  }
  return { ok: false, error: lastError }
}

/**
 * R-ONE compares WRTTIME as an identifier, not a calendar year.
 * A bare end year of 2026 stops at 2025-12. Monthly bounds are YYYYMM.
 * Weekly bounds are YYYYWW (week-of-year), so the end week is 53.
 */
export function roneTimeWindows(now: Date, cycle: 'MM' | 'WK'): Array<{ start: string; end: string }> {
  const endYear = now.getUTCFullYear()
  const startYear = endYear - 3
  const windows: Array<{ start: string; end: string }> = []
  for (let year = startYear; year <= endYear; year++) {
    if (cycle === 'WK') {
      windows.push({ start: `${year}01`, end: `${year}53` })
      continue
    }
    const endMonth = year === endYear ? String(now.getUTCMonth() + 1).padStart(2, '0') : '12'
    windows.push({ start: `${year}01`, end: `${year}${endMonth}` })
  }
  return windows
}

export function roneTableForRegion(regionCode: string): { statblId: string; cycle: 'MM' | 'WK' } {
  if (regionCode === 'NAT' || regionCode.length <= 2) return { statblId: RONE_MONTHLY_STATBL, cycle: 'MM' }
  return { statblId: RONE_SIGUNGU_STATBL, cycle: 'MM' }
}

export function roneTableUrl(args: {
  key: string
  statblId: string
  startYear: string
  endYear: string
  cycle?: string
  page?: number
  pageSize?: number
}): string {
  const url = new URL(RONE_DATA_URL)
  url.searchParams.set('KEY', args.key)
  url.searchParams.set('Type', 'json')
  url.searchParams.set('STATBL_ID', args.statblId)
  url.searchParams.set('DTACYCLE_CD', args.cycle ?? 'MM')
  url.searchParams.set('START_WRTTIME', args.startYear)
  url.searchParams.set('END_WRTTIME', args.endYear)
  url.searchParams.set('pIndex', String(args.page ?? 1))
  url.searchParams.set('pSize', String(args.pageSize ?? 200))
  return url.toString()
}

export async function fetchRoneTable(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
  statblId = RONE_MONTHLY_STATBL,
  cycle: 'MM' | 'WK' = 'MM',
): Promise<HousingFetchResult> {
  if (!apiKey?.trim()) return { ok: false, error: 'RONE_API_KEY missing' }
  try {
    const rows: RoneRow[] = []
    for (const span of roneTimeWindows(now, cycle)) {
      for (let page = 1; page <= 40; page++) {
        const url = roneTableUrl({
          key: apiKey.trim(),
          statblId,
          startYear: span.start,
          endYear: span.end,
          cycle,
          page,
          pageSize: 200,
        })
        const res = await fetchImpl(url)
        if (!res.ok) return { ok: false, error: `R-ONE HTTP ${res.status}` }
        const body = await res.json()
        const rawCount = roneRawRowCount(body)
        if (rawCount === 0) break
        rows.push(...indexRows(parseRoneTable(body)))
        const total = roneTotalCount(body)
        if (rawCount < 200 || (total != null && page * 200 >= total)) break
      }
    }
    const selected = cycle === 'WK' ? lastWeeklyRonePrints(rows) : rows
    const points = pointsFromRone(selected, statblId)
    if (points.length === 0) return { ok: false, error: 'R-ONE returned no catalog regions' }
    return { ok: true, source: 'R-ONE', seriesId: statblId, sourceUrl: RONE_PORTAL, points }
  } catch (err) {
    return { ok: false, error: redactHousingSecrets(err instanceof Error ? err.message : 'R-ONE fetch failed') }
  }
}

export async function fetchRoneRegion(
  regionCode: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
  statblId?: string,
): Promise<HousingFetchResult> {
  const spec = roneTableForRegion(regionCode)
  const tableId = statblId?.trim() || spec.statblId
  const table = await fetchRoneTable(apiKey, fetchImpl, now, tableId, tableId === RONE_WEEKLY_STATBL ? 'WK' : spec.cycle)
  if (!table.ok) return table
  const points = pointsForArea(table.points, regionCode)
  if (points.length > 0) return { ...table, points }
  if (tableId !== RONE_SIGUNGU_STATBL) {
    return { ok: false, error: `R-ONE has no monthly apartment sale index row for ${regionCode}` }
  }
  const weekly = await fetchRoneTable(apiKey, fetchImpl, now, RONE_WEEKLY_STATBL, 'WK')
  if (!weekly.ok) return { ok: false, error: `R-ONE has no monthly apartment sale index row for ${regionCode}` }
  const weekPoints = pointsForArea(weekly.points, regionCode)
  if (weekPoints.length === 0) return { ok: false, error: `R-ONE has no monthly apartment sale index row for ${regionCode}` }
  return { ...weekly, points: weekPoints }
}

export async function fetchEstatTable(
  appId: string | undefined,
  statsDataId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<HousingFetchResult> {
  if (!appId?.trim()) return { ok: false, error: 'ESTAT_APP_ID missing' }
  try {
    const tableId = statsDataId?.trim() || (await findEstatHousingTable(appId.trim(), fetchImpl))
    if (!tableId) return { ok: false, error: 'e-Stat housing table id was not found' }
    const url = new URL(ESTAT_JSON)
    url.searchParams.set('appId', appId.trim())
    url.searchParams.set('statsDataId', tableId)
    url.searchParams.set('limit', '100000')
    const res = await fetchImpl(url.toString())
    if (!res.ok) return { ok: false, error: `e-Stat HTTP ${res.status}` }
    const points = parseEstatHousing(await res.json(), tableId)
    if (points.length === 0) return { ok: false, error: 'e-Stat housing table had no residential composite rows' }
    return { ok: true, source: 'e-Stat', seriesId: tableId, sourceUrl: ESTAT_PAGE, points }
  } catch (err) {
    return { ok: false, error: redactHousingSecrets(err instanceof Error ? err.message : 'e-Stat fetch failed') }
  }
}

export async function fetchEstatHousing(
  regionCode: string,
  appId: string | undefined,
  statsDataId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<HousingFetchResult> {
  const table = await fetchEstatTable(appId, statsDataId, fetchImpl)
  if (!table.ok) return table
  const points = table.points.filter((row) => catalogRegionForEstatArea(row.areaName ?? '') === regionCode)
  if (points.length === 0) return { ok: false, error: `e-Stat has no residential composite for ${regionCode}` }
  return { ...table, points }
}

export async function findEstatHousingTable(appId: string, fetchImpl: typeof fetch): Promise<string | null> {
  const url = new URL(ESTAT_LIST)
  url.searchParams.set('appId', appId)
  url.searchParams.set('searchWord', '不動産価格指数')
  url.searchParams.set('limit', '20')
  const res = await fetchImpl(url.toString())
  if (!res.ok) return null
  const body = await res.json()
  const tables = estatListTables(body)
  const housing = tables.find((row) => /住宅/.test(row.title) && !/商業/.test(row.title))
  return housing?.id ?? null
}

export function estatListTables(body: unknown): Array<{ id: string; title: string }> {
  const list = (
    body as {
      GET_STATS_LIST?: { DATALIST_INF?: { TABLE_INF?: unknown } }
    }
  )?.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF
  const rows = Array.isArray(list) ? list : list ? [list] : []
  const out: Array<{ id: string; title: string }> = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as { '@id'?: string; TITLE?: unknown; STAT_NAME?: unknown; STATISTICS_NAME?: unknown }
    const title = estatText(rec.TITLE) || estatText(rec.STATISTICS_NAME) || estatText(rec.STAT_NAME)
    if (rec['@id']) out.push({ id: rec['@id'], title })
  }
  return out
}

function estatText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && '$' in value) return String((value as { $: unknown }).$)
  return ''
}

export function pointsForArea(points: readonly ParsedPoint[], areaCode: string): ParsedPoint[] {
  return points.filter((row) => row.areaCode === areaCode)
}

function indexRows(rows: RoneRow[]): RoneRow[] {
  const named = rows.filter((row) => row.itmName)
  if (named.length === 0) return rows
  return named.filter((row) => row.itmName === '지수')
}

function pointsFromRone(rows: readonly RoneRow[], statblId: string): ParsedPoint[] {
  const points: ParsedPoint[] = []
  for (const row of rows) {
    const areaCode = catalogRegionForRonePath(row.clsName, row.clsFullName)
    if (!areaCode) continue
    points.push({
      refPeriod: row.refPeriod,
      value: row.value,
      areaCode,
      areaName: row.clsFullName || row.clsName,
      seriesId: statblId,
    })
  }
  return points
}

function roneRawRowCount(body: unknown): number {
  const root = (body as { SttsApiTblData?: unknown })?.SttsApiTblData
  const blocks = Array.isArray(root) ? root : []
  const rowBlock = blocks.find((block) => block && typeof block === 'object' && 'row' in (block as object)) as
    | { row?: unknown }
    | undefined
  if (Array.isArray(rowBlock?.row)) return rowBlock.row.length
  return rowBlock?.row ? 1 : 0
}

function roneTotalCount(body: unknown): number | null {
  const root = (body as { SttsApiTblData?: unknown })?.SttsApiTblData
  const blocks = Array.isArray(root) ? root : []
  const head = blocks.find((block) => block && typeof block === 'object' && 'head' in (block as object)) as
    | { head?: unknown }
    | undefined
  const items = Array.isArray(head?.head) ? head.head : []
  for (const item of items) {
    if (item && typeof item === 'object' && 'list_total_count' in item) {
      const count = Number((item as { list_total_count?: unknown }).list_total_count)
      if (Number.isFinite(count)) return count
    }
  }
  return null
}

export async function fetchMlitHousing(fetchImpl: typeof fetch = fetch): Promise<HousingFetchResult> {
  try {
    const page = await fetchImpl(MLIT_HOUSING_PAGE)
    const html = page.ok ? await page.text() : ''
    const href = mlitHousingWorkbookUrl(html) ?? MLIT_HOUSING_XLSX
    const fileUrl = href.startsWith('http') ? href : new URL(href, 'https://www.mlit.go.jp').toString()
    const file = await fetchImpl(fileUrl)
    if (!file.ok) return { ok: false, error: `MLIT housing workbook HTTP ${file.status}` }
    const workbook = new ExcelJS.Workbook()
    const payload = Buffer.from(await file.arrayBuffer())
    await workbook.xlsx.load(payload as unknown as Parameters<(typeof workbook.xlsx)['load']>[0])
    const seriesId = /(\d+)\.xlsx/.exec(fileUrl)?.[1] ?? MLIT_HOUSING_FILE_ID
    const points: ParsedPoint[] = []
    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) => {
        const point = parseMlitHousingRow(row.values as unknown[], sheet.name, seriesId)
        if (point) points.push(point)
      })
    }
    if (points.length === 0) return { ok: false, error: 'MLIT workbook had no NSA residential composite rows' }
    return { ok: true, source: 'MLIT', seriesId, sourceUrl: MLIT_HOUSING_PAGE, points }
  } catch (err) {
    return { ok: false, error: redactHousingSecrets(err instanceof Error ? err.message : 'MLIT fetch failed') }
  }
}
