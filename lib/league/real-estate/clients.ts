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
 * - Japan: e-Stat. Register at https://www.e-stat.go.jp/mypage/user/preregister
 *   then issue an application ID and set ESTAT_APP_ID. Optional
 *   ESTAT_HOUSING_STATS_DATA_ID skips the table search.
 * - Australia: no client. ABS 6416.0 RPPI ceased after December quarter 2021.
 */

import type { PropertyRegion } from '../gateway/adapters/real-estate-regions'
import {
  catalogRegionForEstatArea,
  catalogRegionForRoneName,
  parseEstatHousing,
  parseFredObservations,
  parseRoneTable,
  parseUkHpiCsv,
  redactHousingSecrets,
  type ParsedPoint,
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

export const UK_HPI_FILE = (yyyyMm: string) =>
  `https://publicdata.landregistry.gov.uk/market-trend-data/house-price-index-data/UK-HPI-full-file-${yyyyMm}.csv`

export const UK_HPI_PAGE = 'https://www.gov.uk/government/collections/uk-house-price-index-reports'
export const FRED_SERIES_PAGE = (id: string) => `https://fred.stlouisfed.org/series/${id}`
export const RONE_PORTAL = 'https://www.reb.or.kr/r-one/portal/main/indexPage.do'
export const ESTAT_PAGE = 'https://www.e-stat.go.jp/'

export const RONE_MONTHLY_STATBL = 'A_2024_00178'
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
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<HousingFetchResult> {
  let lastError = 'UK HPI file not found'
  for (let back = 0; back < 6; back++) {
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    const stamp = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`
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

export function roneTableUrl(args: { key: string; statblId: string; startYear: string; endYear: string }): string {
  const url = new URL(RONE_DATA_URL)
  url.searchParams.set('KEY', args.key)
  url.searchParams.set('Type', 'json')
  url.searchParams.set('STATBL_ID', args.statblId)
  url.searchParams.set('DTACYCLE_CD', 'MM')
  url.searchParams.set('START_WRTTIME', args.startYear)
  url.searchParams.set('END_WRTTIME', args.endYear)
  url.searchParams.set('pIndex', '1')
  url.searchParams.set('pSize', '1000')
  return url.toString()
}

export async function fetchRoneTable(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
  statblId = RONE_MONTHLY_STATBL,
): Promise<HousingFetchResult> {
  if (!apiKey?.trim()) return { ok: false, error: 'RONE_API_KEY missing' }
  const endYear = String(now.getUTCFullYear())
  const startYear = String(now.getUTCFullYear() - 3)
  const url = roneTableUrl({ key: apiKey.trim(), statblId, startYear, endYear })
  try {
    const res = await fetchImpl(url)
    if (!res.ok) return { ok: false, error: `R-ONE HTTP ${res.status}` }
    const points: ParsedPoint[] = []
    for (const row of parseRoneTable(await res.json())) {
      const areaCode = catalogRegionForRoneName(row.clsName)
      if (!areaCode) continue
      points.push({
        refPeriod: row.refPeriod,
        value: row.value,
        areaCode,
        areaName: row.clsName,
        seriesId: statblId,
      })
    }
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
  statblId = RONE_MONTHLY_STATBL,
): Promise<HousingFetchResult> {
  const table = await fetchRoneTable(apiKey, fetchImpl, now, statblId)
  if (!table.ok) return table
  const points = pointsForArea(table.points, regionCode)
  if (points.length === 0) return { ok: false, error: `R-ONE has no monthly apartment sale index row for ${regionCode}` }
  return { ...table, points }
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
    const rec = row as { '@id'?: string; TITLE?: unknown; STAT_NAME?: unknown }
    const title = typeof rec.TITLE === 'string' ? rec.TITLE : typeof rec.STAT_NAME === 'string' ? rec.STAT_NAME : ''
    if (rec['@id']) out.push({ id: rec['@id'], title })
  }
  return out
}

export function pointsForArea(points: readonly ParsedPoint[], areaCode: string): ParsedPoint[] {
  return points.filter((row) => row.areaCode === areaCode)
}
