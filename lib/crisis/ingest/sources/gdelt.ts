import JSZip from 'jszip'
import { assignLatLonBatch } from '../assign'
import { asRecord, finiteNumber, politeFetch } from '../fetch'
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

export function gdeltFipsToIso3(code: string | null | undefined): string | null {
  if (!code) return null
  const key = code.trim().toUpperCase()
  if (key.length !== 2) return null
  return GDELT_FIPS_TO_ISO3[key] ?? null
}

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
  goldstein: number | null
  tone: number | null
  sources: number
  lat: number | null
  lon: number | null
  fips: string | null
  day: string | null
}

function looksLikeLat(value: string): boolean {
  const n = Number(value)
  return Number.isFinite(n) && Math.abs(n) <= 90 && value.includes('.')
}

/** GDELT 2.0 Events TSV. ActionGeo lat/lon is 53/54 (no ADM2) or 54/55 (with ADM2). */
export function parseGdeltExportTsv(text: string): GdeltEventRow[] {
  const out: GdeltEventRow[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cols = line.split('\t')
    if (cols.length < 35) continue
    const root = (cols[28] ?? '').trim() || null
    const goldstein = finiteNumber(cols[30])
    const sources = finiteNumber(cols[32]) ?? 0
    const tone = finiteNumber(cols[34])
    const fips = (cols[51] ?? '').trim() || null
    let lat = finiteNumber(cols[53])
    let lon = finiteNumber(cols[54])
    if (cols.length >= 56 && !looksLikeLat(cols[53] ?? '') && looksLikeLat(cols[54] ?? '')) {
      lat = finiteNumber(cols[54])
      lon = finiteNumber(cols[55])
    }
    const sqlDate = (cols[1] ?? '').trim()
    const day = /^\d{8}$/.test(sqlDate) ? `${sqlDate.slice(0, 4)}-${sqlDate.slice(4, 6)}-${sqlDate.slice(6, 8)}` : null
    out.push({ root, goldstein, tone, sources, lat, lon, fips, day })
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
    goldstein_sum: 0,
    tone_sum: 0,
    num_sources: 0,
  }
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
    const events = parseGdeltExportTsv(tsv)
    ctx.log(`[gdelt_events] export=${exportUrl} events=${events.length}`)

    const unique = new Map<string, { i: number; lat: number; lon: number }>()
    const points: Array<{ i: number; lat: number; lon: number }> = []
    for (const row of events) {
      if (row.lat == null || row.lon == null) continue
      const key = `${row.lat.toFixed(3)},${row.lon.toFixed(3)}`
      if (unique.has(key)) continue
      const i = points.length
      const pt = { i, lat: row.lat, lon: row.lon }
      unique.set(key, pt)
      points.push(pt)
    }

    let assigned = new Map<number, { region_id: number; country_iso3: string | null }>()
    try {
      assigned = await assignLatLonBatch(ctx.client, points)
    } catch (error) {
      ctx.log(`[gdelt_events] assign skipped: ${error instanceof Error ? error.message : error}`)
    }
    const countryIds = await loadCountryIdByIso3(ctx.client).catch(() => new Map<string, number>())

    const aggs = new Map<string, GdeltAgg>()
    const pointByCoord = unique
    for (const row of events) {
      const day = row.day ?? ctx.now.toISOString().slice(0, 10)
      let regionId: number | null = null
      if (row.lat != null && row.lon != null) {
        const pt = pointByCoord.get(`${row.lat.toFixed(3)},${row.lon.toFixed(3)}`)
        if (pt) regionId = assigned.get(pt.i)?.region_id ?? null
      }
      if (regionId == null) {
        const iso3 = gdeltFipsToIso3(row.fips)
        regionId = iso3 ? countryIds.get(iso3) ?? null : null
      }
      if (regionId == null) continue
      const key = `${regionId}|${day}`
      const agg = aggs.get(key) ?? emptyGdeltAgg(regionId, day)
      addGdeltEvent(agg, row)
      aggs.set(key, agg)
    }

    const daily: NormalizedDaily[] = []
    if (!ctx.dryRun && aggs.size) {
      const days = [...new Set([...aggs.values()].map((row) => row.day))]
      const regionIds = [...new Set([...aggs.values()].map((row) => row.region_id))]
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
      for (const agg of aggs.values()) {
        const merged = mergeGdeltStats(prevByKey.get(`${agg.region_id}|${agg.day}`), agg)
        const histRow = sums.get(agg.region_id)
        const mean = histRow && histRow.n > 0 ? histRow.sum / histRow.n : null
        daily.push(gdeltAggToDaily(merged, mean))
      }
    } else {
      for (const agg of aggs.values()) daily.push(gdeltAggToDaily(agg, null))
    }

    return {
      httpCalls: 2,
      daily,
      cursor: { last_export: exportUrl },
      quotaNote: `export=${exportUrl.split('/').pop()} events=${events.length} regions=${daily.length}`,
    }
  },
}
