import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeName } from './iso'
import type { ForecastRegion, IngestStateRow } from './types'

export async function loadStateSafe(client: SupabaseClient, key: string): Promise<IngestStateRow | null> {
  const { data, error } = await client.from('crisis_ingest_state').select('*').eq('source', key).maybeSingle()
  if (error) return null
  return (data as IngestStateRow | null) ?? null
}

interface RegionRow {
  id: number
  level: number
  iso3: string | null
  admin1_code: string | null
  name: string | null
  name_local: string | null
  parent_id: number | null
  centroid: { type: string; coordinates: [number, number] } | string | null
}

function centroidLonLat(centroid: RegionRow['centroid']): { lon: number; lat: number } | null {
  if (!centroid) return null
  if (typeof centroid === 'object' && Array.isArray(centroid.coordinates)) {
    const [lon, lat] = centroid.coordinates
    if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat }
  }
  if (typeof centroid === 'string') {
    const match = /POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i.exec(centroid)
    if (match) {
      const lon = Number(match[1])
      const lat = Number(match[2])
      if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat }
    }
  }
  return null
}

export async function loadAllRegions(client: SupabaseClient): Promise<RegionRow[]> {
  const rows: RegionRow[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await client
      .from('crisis_regions')
      .select('id, level, iso3, admin1_code, name, name_local, parent_id, centroid')
      .order('id', { ascending: true })
      .range(from, from + page - 1)
    if (error) throw new Error(`crisis_regions: ${error.message}`)
    const chunk = (data ?? []) as RegionRow[]
    rows.push(...chunk)
    if (chunk.length < page) break
  }
  return rows
}

export function forecastRegionsFromRows(rows: RegionRow[]): ForecastRegion[] {
  const admin1Parents = new Set(
    rows.filter((row) => row.level === 1 && row.parent_id != null).map((row) => row.parent_id as number),
  )
  const out: ForecastRegion[] = []
  for (const row of rows) {
    const point = centroidLonLat(row.centroid)
    if (!point) continue
    const useAdmin1 = row.level === 1
    const useCountryFallback = row.level === 0 && !admin1Parents.has(row.id)
    if (!useAdmin1 && !useCountryFallback) continue
    out.push({
      id: Number(row.id),
      level: row.level === 1 ? 1 : 0,
      iso3: row.iso3,
      admin1_code: row.admin1_code,
      name: row.name,
      name_local: row.name_local,
      lat: point.lat,
      lon: point.lon,
    })
  }
  return out
}

export async function loadForecastRegions(client: SupabaseClient): Promise<ForecastRegion[]> {
  return forecastRegionsFromRows(await loadAllRegions(client))
}

export async function loadCountryIdByIso3(client: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await client
    .from('crisis_regions')
    .select('id, iso3')
    .eq('level', 0)
    .not('iso3', 'is', null)
    .limit(400)
  if (error) throw new Error(`crisis_regions countries: ${error.message}`)
  const map = new Map<string, number>()
  for (const row of data ?? []) {
    if (typeof row.iso3 === 'string') map.set(row.iso3.toUpperCase(), Number(row.id))
  }
  return map
}

export async function loadHighInformRegions(client: SupabaseClient, fraction = 0.5): Promise<ForecastRegion[]> {
  const regions = await loadForecastRegions(client)
  const { data, error } = await client
    .from('crisis_region_metrics')
    .select('region_id, value, issued_at')
    .eq('metric', 'inform_risk')
    .order('issued_at', { ascending: false })
    .limit(4000)
  if (error) throw new Error(`inform_risk metrics: ${error.message}`)

  const latest = new Map<number, number>()
  for (const row of data ?? []) {
    const id = Number(row.region_id)
    if (latest.has(id)) continue
    if (typeof row.value === 'number') latest.set(id, row.value)
  }

  const byIso3 = new Map<string, number>()
  const regionById = new Map(regions.map((row) => [row.id, row]))
  for (const [id, score] of latest) {
    const region = regionById.get(id)
    if (region?.iso3) byIso3.set(region.iso3, score)
  }
  // Country-level INFORM rows may live on the country region id, not admin1.
  const allRows = await loadAllRegions(client)
  for (const row of allRows) {
    const score = latest.get(Number(row.id))
    if (score != null && row.iso3) {
      const prev = byIso3.get(row.iso3)
      if (prev == null || score > prev) byIso3.set(row.iso3, score)
    }
  }

  const ranked = regions
    .map((region) => ({ region, score: region.iso3 ? byIso3.get(region.iso3) ?? -1 : -1 }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)

  if (!ranked.length) return []
  const take = Math.max(1, Math.ceil(ranked.length * fraction))
  return ranked.slice(0, take).map((item) => item.region)
}

export async function loadDischargeMeans(client: SupabaseClient): Promise<Map<number, number>> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const sums = new Map<number, { sum: number; n: number }>()
  const add = (id: number, value: number) => {
    const cur = sums.get(id) ?? { sum: 0, n: 0 }
    cur.sum += value
    cur.n += 1
    sums.set(id, cur)
  }

  const forecasts = await client
    .from('crisis_region_forecasts')
    .select('region_id, series')
    .eq('source', 'glofas')
    .gte('issued_date', since)
    .limit(20000)
  if (!forecasts.error) {
    for (const row of forecasts.data ?? []) {
      const series = row.series as { discharge_m3s?: unknown[] } | null
      for (const value of series?.discharge_m3s ?? []) {
        if (typeof value === 'number' && Number.isFinite(value)) add(Number(row.region_id), value)
      }
    }
  }

  const legacy = await client
    .from('crisis_region_metrics')
    .select('region_id, value')
    .eq('metric', 'river_discharge')
    .gte('valid_time', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
    .limit(20000)
  if (!legacy.error) {
    for (const row of legacy.data ?? []) {
      if (typeof row.value === 'number' && Number.isFinite(row.value)) add(Number(row.region_id), row.value)
    }
  }

  const means = new Map<number, number>()
  for (const [id, cur] of sums) {
    if (cur.n > 0) means.set(id, cur.sum / cur.n)
  }
  return means
}

export interface RegionIndex {
  byIso3: Map<string, ForecastRegion[]>
  byName: Map<string, ForecastRegion[]>
}

export function buildRegionIndex(regions: ForecastRegion[]): RegionIndex {
  const byIso3 = new Map<string, ForecastRegion[]>()
  const byName = new Map<string, ForecastRegion[]>()
  for (const region of regions) {
    if (region.iso3) {
      const list = byIso3.get(region.iso3) ?? []
      list.push(region)
      byIso3.set(region.iso3, list)
    }
    for (const label of [region.name, region.name_local]) {
      const key = normalizeName(label)
      if (!key) continue
      const list = byName.get(key) ?? []
      list.push(region)
      byName.set(key, list)
    }
  }
  return { byIso3, byName }
}

export function matchRegion(
  index: RegionIndex,
  opts: { iso3?: string | null; names?: Array<string | null | undefined> },
): ForecastRegion | null {
  const iso3 = opts.iso3?.toUpperCase() ?? null
  const names = (opts.names ?? []).map(normalizeName).filter(Boolean)
  const countryPool = iso3 ? index.byIso3.get(iso3) ?? [] : []

  for (const name of names) {
    const hits = (iso3 ? countryPool : index.byName.get(name) ?? []).filter((row) => {
      const labels = [normalizeName(row.name), normalizeName(row.name_local)]
      return labels.includes(name)
    })
    const admin1 = hits.find((row) => row.level === 1)
    if (admin1) return admin1
    if (hits[0]) return hits[0]
    const global = index.byName.get(name) ?? []
    const globalAdmin1 = global.find((row) => row.level === 1 && (!iso3 || row.iso3 === iso3))
    if (globalAdmin1) return globalAdmin1
  }

  if (countryPool.length) {
    return countryPool.find((row) => row.level === 0) ?? countryPool[0]
  }
  return null
}
