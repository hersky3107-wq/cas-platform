import JSZip from 'jszip'
import { assignLatLonBatch } from '../assign'
import { asRecord, finiteNumber, politeFetch } from '../fetch'
import { ISO2_TO_ISO3 } from '../iso'
import { loadCountryIdByIso3, loadStateSafe } from '../regions'
import type { CrisisSource, IngestFetchResult, NormalizedDaily } from '../types'

export const GDELT_LASTUPDATE = 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt'
export const GDELT_CAMEO = {
  protest: '14',
  coerce: '17',
  assault: '18',
  fight: '19',
  mass_violence: '20',
} as const

/**
 * GDELT 2.0 Events uses FIPS 10-4 country codes, not ISO2.
 * Common mismatches vs ISO2 are listed; identity codes still resolve via ISO2_TO_ISO3 fallback.
 */
export const GDELT_FIPS_TO_ISO3: Record<string, string> = {
  AA: 'ABW', AC: 'ATG', AE: 'ARE', AF: 'AFG', AG: 'DZA', AJ: 'AZE', AL: 'ALB', AM: 'ARM',
  AN: 'AND', AO: 'AGO', AR: 'ARG', AS: 'AUS', AT: 'AUT', AU: 'AUT',
  BA: 'BHR', BB: 'BRB', BC: 'BWA', BD: 'BMU', BE: 'BEL', BF: 'BHS', BG: 'BGD', BH: 'BLZ',
  BK: 'BIH', BL: 'BOL', BM: 'MMR', BN: 'BEN', BO: 'BLR', BP: 'SLB', BR: 'BRA', BT: 'BTN',
  BU: 'BGR', BX: 'BRN', BY: 'BDI', CA: 'CAN', CB: 'KHM', CD: 'TCD', CE: 'LKA', CF: 'COG',
  CG: 'COD', CH: 'CHN', CI: 'CHL', CJ: 'CYM', CM: 'CMR', CN: 'COM', CO: 'COL', CS: 'CRI',
  CT: 'CAF', CU: 'CUB', CV: 'CPV', CY: 'CYP', DA: 'DNK', DJ: 'DJI', DO: 'DMA', DR: 'DOM',
  EC: 'ECU', EG: 'EGY', EI: 'IRL', EK: 'GNQ', EN: 'EST', ER: 'ERI', ES: 'SLV', ET: 'ETH',
  EZ: 'CZE', FI: 'FIN', FJ: 'FJI', FR: 'FRA', GA: 'GMB', GB: 'GAB', GG: 'GEO', GH: 'GHA',
  GI: 'GIB', GJ: 'GRD', GM: 'DEU', GR: 'GRC', GT: 'GTM', GV: 'GIN', GY: 'GUY', GZ: 'PSE',
  HA: 'HTI', HK: 'HKG', HO: 'HND', HR: 'HRV', HU: 'HUN', IC: 'ISL', ID: 'IDN', IN: 'IND',
  IR: 'IRN', IS: 'ISR', IT: 'ITA', IV: 'CIV', IZ: 'IRQ', JA: 'JPN', JM: 'JAM', JO: 'JOR',
  KE: 'KEN', KG: 'KGZ', KN: 'PRK', KR: 'KIR', KS: 'KOR', KU: 'KWT', KV: 'XKX', KZ: 'KAZ',
  LA: 'LAO', LE: 'LBN', LG: 'LVA', LH: 'LTU', LI: 'LBR', LO: 'SVK', LS: 'LIE', LT: 'LSO',
  LU: 'LUX', LY: 'LBY', MA: 'MDG', MC: 'MAC', MD: 'MDA', MG: 'MNG', MI: 'MWI', ML: 'MLI',
  MN: 'MCO', MO: 'MAR', MP: 'MUS', MR: 'MRT', MT: 'MLT', MU: 'OMN', MV: 'MDV', MX: 'MEX',
  MY: 'MYS', MZ: 'MOZ', NC: 'NCL', NE: 'NER', NG: 'NER', NH: 'VUT', NI: 'NGA', NL: 'NLD',
  NO: 'NOR', NP: 'NPL', NR: 'NRU', NS: 'SUR', NU: 'NIC', NZ: 'NZL', PA: 'PRY', PE: 'PER',
  PK: 'PAK', PL: 'POL', PM: 'PAN', PO: 'PRT', PP: 'PNG', PS: 'PLW', PU: 'GNB', QA: 'QAT',
  RI: 'SRB', RM: 'MHL', RO: 'ROU', RP: 'PHL', RS: 'RUS', RW: 'RWA', SA: 'SAU',
  SE: 'SYC', SF: 'ZAF', SG: 'SEN', SH: 'SHN', SI: 'SVN', SL: 'SLE', SM: 'SMR', SN: 'SGP',
  SO: 'SOM', SP: 'ESP', ST: 'LCA', SU: 'SDN', SV: 'SVN', SW: 'SWE', SY: 'SYR', SZ: 'CHE',
  TD: 'TTO', TH: 'THA', TI: 'TJK', TN: 'TON', TO: 'TGO', TP: 'STP', TS: 'TUN', TT: 'TLS',
  TU: 'TUR', TX: 'TKM', TZ: 'TZA', UG: 'UGA', UK: 'GBR', UP: 'UKR', US: 'USA', UV: 'BFA',
  UY: 'URY', UZ: 'UZB', VC: 'VCT', VE: 'VEN', VM: 'VNM', VT: 'VAT', WA: 'NAM',
  WI: 'ESH', WZ: 'SWZ', YM: 'YEM', ZA: 'ZMB', ZI: 'ZWE', TW: 'TWN', WE: 'PSE',
}

const KNOWN_ISO3 = new Set<string>([...Object.values(ISO2_TO_ISO3), ...Object.values(GDELT_FIPS_TO_ISO3)])

export function gdeltFipsToIso3(code: string | null | undefined): string | null {
  if (!code) return null
  const key = code.trim().toUpperCase()
  if (key.length !== 2) return null
  return GDELT_FIPS_TO_ISO3[key] ?? ISO2_TO_ISO3[key] ?? null
}

/** Actor country codes are 3-letter CAMEO/ISO3. ActionGeo codes stay 2-letter FIPS. */
export function gdeltActorToIso3(code: string | null | undefined): string | null {
  if (!code) return null
  const key = code.trim().toUpperCase()
  if (key.length === 3) return KNOWN_ISO3.has(key) ? key : null
  return gdeltFipsToIso3(key)
}

/**
 * GDELT 2.0 Event codebook, 61 tab-separated fields, 0-based.
 * http://data.gdeltproject.org/documentation/GDELT-Event_Codebook-V2.0.pdf
 * ActionGeo_Lat/Long are 57/58 in the 1-based codebook (56/57 here), not the country code.
 */
export const GDELT_COL = {
  SQLDATE: 1,
  Actor1CountryCode: 7,
  Actor2CountryCode: 17,
  EventCode: 26,
  EventRootCode: 28,
  QuadClass: 29,
  GoldsteinScale: 30,
  NumMentions: 31,
  NumSources: 32,
  AvgTone: 34,
  ActionGeo_Type: 51,
  ActionGeo_FullName: 52,
  ActionGeo_CountryCode: 53,
  ActionGeo_ADM1Code: 54,
  ActionGeo_ADM2Code: 55,
  ActionGeo_Lat: 56,
  ActionGeo_Long: 57,
} as const

/** GDELT 1.0 daily files have 58 columns and no ActionGeo ADM2, so lat/lon sit earlier. */
export const GDELT_V1_GEO = {
  CountryCode: 51,
  Lat: 53,
  Long: 54,
} as const

export function parseGdeltLastupdate(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    const url = parts.find((part) => part.includes('.export.CSV.zip'))
    if (url) return url
  }
  return null
}

export interface GdeltEventRow {
  root: string | null
  code: string | null
  goldstein: number | null
  tone: number | null
  sources: number
  lat: number | null
  lon: number | null
  fips: string | null
  day: string | null
  quad: number | null
  mentions: number
  actor1: string | null
  actor2: string | null
}

function coord(value: string | undefined, limit: number): number | null {
  const n = finiteNumber(value)
  if (n == null || Math.abs(n) > limit) return null
  return n
}

export function describeGdeltRow(line: string): string {
  const cols = line.split('\t')
  const at = (index: number) => cols[index] ?? ''
  return [
    `ncols=${cols.length}`,
    `EventRootCode=${at(GDELT_COL.EventRootCode)}`,
    `GoldsteinScale=${at(GDELT_COL.GoldsteinScale)}`,
    `NumSources=${at(GDELT_COL.NumSources)}`,
    `AvgTone=${at(GDELT_COL.AvgTone)}`,
    `ActionGeo_Type=${at(GDELT_COL.ActionGeo_Type)}`,
    `ActionGeo_CountryCode=${at(GDELT_COL.ActionGeo_CountryCode)}`,
    `ActionGeo_ADM1Code=${at(GDELT_COL.ActionGeo_ADM1Code)}`,
    `ActionGeo_Lat=${at(GDELT_COL.ActionGeo_Lat)}`,
    `ActionGeo_Long=${at(GDELT_COL.ActionGeo_Long)}`,
  ].join(' ')
}

/** GDELT 2.0 Events TSV. Lat/lon are codebook fields 57/58 (0-based 56/57). */
export function parseGdeltExportTsv(text: string): GdeltEventRow[] {
  const out: GdeltEventRow[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cols = line.split('\t')
    const v2 = cols.length >= 61
    const fipsIndex = v2 ? GDELT_COL.ActionGeo_CountryCode : GDELT_V1_GEO.CountryCode
    const latIndex = v2 ? GDELT_COL.ActionGeo_Lat : GDELT_V1_GEO.Lat
    const lonIndex = v2 ? GDELT_COL.ActionGeo_Long : GDELT_V1_GEO.Long
    if (cols.length <= lonIndex) continue
    const root = (cols[GDELT_COL.EventRootCode] ?? '').trim() || null
    const code = v2 ? (cols[GDELT_COL.EventCode] ?? '').trim() || null : null
    const goldstein = finiteNumber(cols[GDELT_COL.GoldsteinScale])
    const sources = finiteNumber(cols[GDELT_COL.NumSources]) ?? 0
    const mentions = finiteNumber(cols[GDELT_COL.NumMentions]) ?? 0
    const tone = finiteNumber(cols[GDELT_COL.AvgTone])
    const quadRaw = finiteNumber(cols[GDELT_COL.QuadClass])
    const quad = quadRaw === 1 || quadRaw === 2 || quadRaw === 3 || quadRaw === 4 ? quadRaw : null
    const fips = (cols[fipsIndex] ?? '').trim() || null
    const lat = coord(cols[latIndex], 90)
    const lon = coord(cols[lonIndex], 180)
    const actor1 = gdeltActorToIso3(cols[GDELT_COL.Actor1CountryCode])
    const actor2 = gdeltActorToIso3(cols[GDELT_COL.Actor2CountryCode])
    const sqlDate = (cols[GDELT_COL.SQLDATE] ?? '').trim()
    const day = /^\d{8}$/.test(sqlDate) ? `${sqlDate.slice(0, 4)}-${sqlDate.slice(4, 6)}-${sqlDate.slice(6, 8)}` : null
    out.push({ root, code, goldstein, tone, sources, lat, lon, fips, day, quad, mentions, actor1, actor2 })
  }
  return out
}

export interface GdeltAgg {
  region_id: number
  day: string
  total_events: number
  protest: number
  coerce: number
  assault: number
  fight: number
  mass_violence: number
  threat: number
  bomb: number
  goldstein_sum: number
  tone_sum: number
  num_sources: number
}

export function emptyGdeltAgg(regionId: number, day: string): GdeltAgg {
  return {
    region_id: regionId,
    day,
    total_events: 0,
    protest: 0,
    coerce: 0,
    assault: 0,
    fight: 0,
    mass_violence: 0,
    threat: 0,
    bomb: 0,
    goldstein_sum: 0,
    tone_sum: 0,
    num_sources: 0,
  }
}

export function gdeltPoints(events: GdeltEventRow[]): Array<{ i: number; lat: number; lon: number }> {
  const unique = new Set<string>()
  const points: Array<{ i: number; lat: number; lon: number }> = []
  for (const row of events) {
    if (row.lat == null || row.lon == null) continue
    const key = `${row.lat.toFixed(3)},${row.lon.toFixed(3)}`
    if (unique.has(key)) continue
    unique.add(key)
    points.push({ i: points.length, lat: row.lat, lon: row.lon })
  }
  return points
}

export function gdeltRegionAggs(
  events: GdeltEventRow[],
  assigned: Map<number, { region_id: number }>,
  points: Array<{ i: number; lat: number; lon: number }>,
  countryIds: Map<string, number>,
  dayFallback: string,
): { aggs: GdeltAgg[]; fipsFallback: number } {
  const byCoord = new Map(points.map((point) => [`${point.lat.toFixed(3)},${point.lon.toFixed(3)}`, point]))
  const aggs = new Map<string, GdeltAgg>()
  let fipsFallback = 0
  for (const row of events) {
    const day = row.day ?? dayFallback
    let regionId: number | null = null
    if (row.lat != null && row.lon != null) {
      const point = byCoord.get(`${row.lat.toFixed(3)},${row.lon.toFixed(3)}`)
      if (point) regionId = assigned.get(point.i)?.region_id ?? null
    }
    if (regionId == null) {
      const iso3 = gdeltFipsToIso3(row.fips)
      regionId = iso3 ? countryIds.get(iso3) ?? null : null
      if (regionId != null) fipsFallback += 1
    }
    if (regionId == null) continue
    const key = `${regionId}|${day}`
    const agg = aggs.get(key) ?? emptyGdeltAgg(regionId, day)
    addGdeltEvent(agg, row)
    aggs.set(key, agg)
  }
  return { aggs: [...aggs.values()], fipsFallback }
}

export function addGdeltEvent(agg: GdeltAgg, row: GdeltEventRow): void {
  agg.total_events += 1
  if (row.goldstein != null) agg.goldstein_sum += row.goldstein
  if (row.tone != null) agg.tone_sum += row.tone
  agg.num_sources += row.sources
  if (row.root === GDELT_CAMEO.protest) agg.protest += 1
  else if (row.root === GDELT_CAMEO.coerce) agg.coerce += 1
  else if (row.root === GDELT_CAMEO.assault) agg.assault += 1
  else if (row.root === GDELT_CAMEO.fight) agg.fight += 1
  else if (row.root === GDELT_CAMEO.mass_violence) agg.mass_violence += 1
  if (row.code?.startsWith('13')) agg.threat += 1
  if (row.code?.startsWith('183')) agg.bomb += 1
}

export function gdeltAggToDaily(agg: GdeltAgg, mean30d: number | null): NormalizedDaily {
  const n = Math.max(1, agg.total_events)
  return {
    region_id: agg.region_id,
    day: agg.day,
    source: 'gdelt',
    stats: {
      total_events: agg.total_events,
      protest: agg.protest,
      coerce: agg.coerce,
      assault: agg.assault,
      fight: agg.fight,
      mass_violence: agg.mass_violence,
      threat: agg.threat,
      bomb: agg.bomb,
      avg_goldstein: agg.goldstein_sum / n,
      avg_tone: agg.tone_sum / n,
      num_sources: agg.num_sources,
      goldstein_sum: agg.goldstein_sum,
      tone_sum: agg.tone_sum,
      mean_30d: mean30d,
    },
  }
}

export function mergeGdeltStats(
  prev: Record<string, unknown> | null | undefined,
  next: GdeltAgg,
): GdeltAgg {
  const rec = asRecord(prev) ?? {}
  const merged = emptyGdeltAgg(next.region_id, next.day)
  merged.total_events = (finiteNumber(rec.total_events) ?? 0) + next.total_events
  merged.protest = (finiteNumber(rec.protest) ?? 0) + next.protest
  merged.coerce = (finiteNumber(rec.coerce) ?? 0) + next.coerce
  merged.assault = (finiteNumber(rec.assault) ?? 0) + next.assault
  merged.fight = (finiteNumber(rec.fight) ?? 0) + next.fight
  merged.mass_violence = (finiteNumber(rec.mass_violence) ?? 0) + next.mass_violence
  merged.threat = (finiteNumber(rec.threat) ?? 0) + next.threat
  merged.bomb = (finiteNumber(rec.bomb) ?? 0) + next.bomb
  merged.goldstein_sum = (finiteNumber(rec.goldstein_sum) ?? 0) + next.goldstein_sum
  merged.tone_sum = (finiteNumber(rec.tone_sum) ?? 0) + next.tone_sum
  merged.num_sources = (finiteNumber(rec.num_sources) ?? 0) + next.num_sources
  return merged
}

export async function unzipGdeltExport(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf)
  const file = Object.values(zip.files).find((entry) => !entry.dir)
  if (!file) throw new Error('GDELT zip had no file')
  return file.async('string')
}

export const gdeltEventsSource: CrisisSource = {
  key: 'gdelt_events',
  department: 'conflict',
  scheduleMinutes: 15,
  writes: 'daily',
  async fetch(ctx): Promise<IngestFetchResult> {
    const state = ctx.dryRun ? null : await loadStateSafe(ctx.client, 'gdelt_events')
    const lastExport = typeof state?.cursor?.last_export === 'string' ? state.cursor.last_export : null

    const listing = await politeFetch(GDELT_LASTUPDATE, { sourceKey: 'gdelt_events', minIntervalMs: 2000, as: 'text' })
    if (!listing.ok) return { httpCalls: 1, error: listing.error ?? `HTTP ${listing.status}` }
    const exportUrl = parseGdeltLastupdate(listing.text)
    if (!exportUrl) return { httpCalls: 1, error: 'lastupdate.txt had no export.CSV.zip' }
    if (!ctx.dryRun && lastExport === exportUrl) {
      return { httpCalls: 1, daily: [], cursor: { last_export: exportUrl }, skipped: 'same GDELT export already ingested' }
    }

    const zipRes = await politeFetch(exportUrl, {
      sourceKey: 'gdelt_events',
      minIntervalMs: 2000,
      timeoutMs: 90_000,
      as: 'bytes',
    })
    if (!zipRes.ok || !(zipRes.data instanceof ArrayBuffer)) {
      return { httpCalls: 2, error: zipRes.error ?? `HTTP ${zipRes.status}` }
    }
    const tsv = await unzipGdeltExport(zipRes.data)
    const firstLine = tsv.split(/\r?\n/).find((line) => line.trim()) ?? ''
    const events = parseGdeltExportTsv(tsv)
    const withCoords = events.filter((row) => row.lat != null && row.lon != null).length
    ctx.log(`[gdelt_events] export=${exportUrl} events=${events.length} ${describeGdeltRow(firstLine)}`)

    const points = gdeltPoints(events)

    let assigned = new Map<number, { region_id: number; country_iso3: string | null }>()
    let assignError: string | null = null
    try {
      assigned = await assignLatLonBatch(ctx.client, points)
    } catch (error) {
      assignError = error instanceof Error ? error.message : String(error)
    }
    const sample = [...assigned.entries()]
      .slice(0, 3)
      .map(([index, hit]) => `${index}:${hit.region_id}/${hit.country_iso3 ?? '-'}`)
      .join(',')
    ctx.log(
      `[gdelt_events] usable_latlon=${withCoords} sent=${points.length} rpc=${assigned.size} rpc_first=${sample || '-'}`,
    )
    if (assignError) ctx.log(`[gdelt_events] rpc error: ${assignError}`)

    let countryIds = new Map<string, number>()
    let countryError: string | null = null
    try {
      countryIds = await loadCountryIdByIso3(ctx.client)
    } catch (error) {
      countryError = error instanceof Error ? error.message : String(error)
      ctx.log(`[gdelt_events] country lookup error: ${countryError}`)
    }

    const rolled = gdeltRegionAggs(events, assigned, points, countryIds, ctx.now.toISOString().slice(0, 10))
    const aggs = rolled.aggs
    const fipsFallback = rolled.fipsFallback

    const daily: NormalizedDaily[] = []
    if (!ctx.dryRun && aggs.length) {
      const days = [...new Set(aggs.map((row) => row.day))]
      const regionIds = [...new Set(aggs.map((row) => row.region_id))]
      const existing = await ctx.client
        .from('crisis_region_daily')
        .select('region_id, day, stats')
        .eq('source', 'gdelt')
        .in('day', days)
        .in('region_id', regionIds)
      const prevByKey = new Map<string, Record<string, unknown>>()
      for (const row of existing.data ?? []) {
        prevByKey.set(`${row.region_id}|${row.day}`, asRecord(row.stats) ?? {})
      }
      const since = new Date(ctx.now.getTime() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
      const hist = await ctx.client
        .from('crisis_region_daily')
        .select('region_id, stats')
        .eq('source', 'gdelt')
        .gte('day', since)
        .in('region_id', regionIds)
      const sums = new Map<number, { sum: number; n: number }>()
      for (const row of hist.data ?? []) {
        const total = finiteNumber(asRecord(row.stats)?.total_events)
        if (total == null) continue
        const id = Number(row.region_id)
        const cur = sums.get(id) ?? { sum: 0, n: 0 }
        cur.sum += total
        cur.n += 1
        sums.set(id, cur)
      }
      for (const agg of aggs) {
        const merged = mergeGdeltStats(prevByKey.get(`${agg.region_id}|${agg.day}`), agg)
        const histRow = sums.get(agg.region_id)
        const mean = histRow && histRow.n > 0 ? histRow.sum / histRow.n : null
        daily.push(gdeltAggToDaily(merged, mean))
      }
    } else {
      for (const agg of aggs) daily.push(gdeltAggToDaily(agg, null))
    }

    const mapError = assignError ?? countryError
    const { aggregateGdeltRelations, mergeStoredRelations } = await import('./gdelt-relations')
    const relations = aggregateGdeltRelations(events, ctx.now.toISOString().slice(0, 10))
    let dyads = relations.dyads
    let countries = relations.countries
    if (!ctx.dryRun && (dyads.length || countries.length)) {
      const merged = await mergeStoredRelations(ctx.client, dyads, countries)
      dyads = merged.dyads
      countries = merged.countries
    }
    ctx.log(`[gdelt_events] regions=${daily.length} dyads=${dyads.length} countries=${countries.length} fips_fallback_events=${fipsFallback}`)
    return {
      httpCalls: 2,
      daily,
      dyads: dyads.map((row) => ({ ...row, stats: { ...row.stats } as Record<string, unknown> })),
      countries: countries.map((row) => ({ ...row, stats: { ...row.stats } as Record<string, unknown> })),
      cursor: { last_export: exportUrl },
      error: mapError ?? undefined,
      quotaNote: `export=${exportUrl.split('/').pop()} events=${events.length} regions=${daily.length} usable_latlon=${withCoords} sent=${points.length} rpc=${assigned.size} fips_fallback=${fipsFallback}`,
    }
  },
}
