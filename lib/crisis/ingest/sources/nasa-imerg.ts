import type { SupabaseClient } from '@supabase/supabase-js'
import { OBSERVED_RAIN } from '../../score/thresholds'
import { rainComponent } from '../../score/trigger'
import { earthdataBearer } from '../earthdata'
import { asArray, asRecord, finiteNumber, politeFetch } from '../fetch'
import { centroidLonLat, loadAllRegions } from '../regions'
import type { CrisisSource, IngestFetchResult, NormalizedMetric } from '../types'

/**
 * Observed rain from GPM IMERG daily V07 (Late run, Early when Late is not out yet).
 * One OPeNDAP point read per grid cell and day on opendap.earthdata.nasa.gov,
 * Earthdata bearer token. Only regions at stage >= 2 today, capped.
 */
export const IMERG_PRODUCTS = { late: 'GPM_3IMERGDL', early: 'GPM_3IMERGDE' } as const
export const IMERG_POINT_CAP = 100
export const IMERG_DAYS = 3
export const IMERG_WORKERS = 4
const CMR_GRANULES = 'https://cmr.earthdata.nasa.gov/search/granules.json'
const FILL_BELOW = -9000

export type ImergRun = keyof typeof IMERG_PRODUCTS

export interface ImergTarget {
  region_id: number
  lat: number
  lon: number
  stage: number
  score: number
}

/** 0.1° grid, centres at -179.95..179.95 lon and -89.95..89.95 lat. */
export function imergCell(lat: number, lon: number): { lonIndex: number; latIndex: number } {
  const lonIndex = Math.min(3599, Math.max(0, Math.round((lon + 179.95) / 0.1)))
  const latIndex = Math.min(1799, Math.max(0, Math.round((lat + 89.95) / 0.1)))
  return { lonIndex, latIndex }
}

/** Last value of a DAP2 ASCII point read. Fill values return null. */
export function parseImergAscii(text: string): number | null {
  const match = /precipitation\.precipitation\[[^\n]*\],\s*(-?[\d.]+(?:[eE][-+]?\d+)?)/.exec(text)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value < FILL_BELOW) return null
  return Math.max(0, value)
}

/** Day → OPeNDAP granule URL from a CMR granules.json payload. */
export function imergGranules(payload: unknown): Map<string, string> {
  const out = new Map<string, string>()
  const entries = asArray(asRecord(asRecord(payload)?.feed)?.entry)
  for (const item of entries) {
    const entry = asRecord(item)
    const day = typeof entry?.time_start === 'string' ? entry.time_start.slice(0, 10) : ''
    const link = asArray(entry?.links)
      .map((row) => asRecord(row))
      .find((row) => typeof row?.href === 'string' && /opendap\.earthdata\.nasa\.gov/.test(row.href as string))
    if (day && typeof link?.href === 'string' && !out.has(day)) out.set(day, link.href.replace(/\.html$/, ''))
  }
  return out
}

export function imergPointUrl(granule: string, lat: number, lon: number): string {
  const { lonIndex, latIndex } = imergCell(lat, lon)
  return `${granule}.ascii?${encodeURIComponent(`precipitation[0:0][${lonIndex}:${lonIndex}][${latIndex}:${latIndex}]`)}`
}

/** For each of the last `days` days with any granule: the Late URL when out, else Early. */
export function pickImergDays(
  late: Map<string, string>,
  early: Map<string, string>,
  days = IMERG_DAYS,
): Array<{ day: string; run: ImergRun; url: string }> {
  const all = [...new Set([...late.keys(), ...early.keys()])].sort().reverse().slice(0, days)
  return all.map((day) => {
    const url = late.get(day)
    return url ? { day, run: 'late' as const, url } : { day, run: 'early' as const, url: early.get(day)! }
  })
}

export function threeDayTotal(
  values: Map<string, { value: number; run: ImergRun }>,
  days: string[],
): { total: number; runs: ImergRun[] } | null {
  if (days.length < IMERG_DAYS) return null
  let total = 0
  const runs: ImergRun[] = []
  for (const day of days) {
    const hit = values.get(day)
    if (!hit) return null
    total += hit.value
    runs.push(hit.run)
  }
  return { total: Math.round(total * 100) / 100, runs }
}

/** Stage >= 2 regions with a high rain forecast first, since only those can be confirmed or downgraded. */
export function rankImergTargets(targets: ImergTarget[], rain: Map<number, number>): ImergTarget[] {
  const tier = (row: ImergTarget) => {
    const value = rain.get(row.region_id) ?? 0
    return value >= OBSERVED_RAIN.forecastHigh ? 2 : value > 0 ? 1 : 0
  }
  return [...targets].sort((a, b) => tier(b) - tier(a) || b.stage - a.stage || b.score - a.score)
}

async function rainForecast(client: SupabaseClient, ids: number[], now: Date): Promise<Map<number, number>> {
  const since = new Date(now.getTime() - 3 * 86_400_000).toISOString().slice(0, 10)
  const latest = new Map<number, { issued: string; value: number }>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await client
      .from('crisis_region_forecasts')
      .select('region_id, issued_date, series')
      .eq('source', 'openmeteo_forecast')
      .in('region_id', ids.slice(i, i + 200))
      .gte('issued_date', since)
    if (error) return new Map()
    for (const row of data ?? []) {
      const series = asRecord(row.series)
      const precip = Array.isArray(series?.precip_mm) ? series.precip_mm.map((value) => finiteNumber(value)) : null
      const id = Number(row.region_id)
      const prev = latest.get(id)
      if (prev && prev.issued >= String(row.issued_date)) continue
      latest.set(id, { issued: String(row.issued_date), value: rainComponent(precip).value })
    }
  }
  return new Map([...latest].map(([id, row]) => [id, row.value]))
}

async function stageTargets(client: SupabaseClient, now: Date, log: (message: string) => void): Promise<{ targets: ImergTarget[]; via: string }> {
  const day = now.toISOString().slice(0, 10)
  const rows: Array<{ region_id: number; value: number; detail: unknown }> = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('crisis_region_flags')
      .select('region_id, value, detail')
      .eq('flag', 'risk_score')
      .eq('flag_date', day)
      .order('region_id', { ascending: true })
      .range(from, from + 999)
    if (error || !data?.length) break
    rows.push(...(data as typeof rows))
    if (data.length < 1000) break
  }
  const flagged = rows
    .map((row) => ({ id: Number(row.region_id), score: Number(row.value) || 0, stage: Number(asRecord(row.detail)?.stage) || 0 }))
    .filter((row) => row.stage >= 2)
  if (flagged.length) {
    const regions = await loadAllRegions(client)
    const centroid = new Map<number, { lat: number; lon: number }>()
    for (const row of regions) {
      const point = centroidLonLat(row.centroid)
      if (point) centroid.set(Number(row.id), point)
    }
    const targets = flagged.flatMap((row) => {
      const point = centroid.get(row.id)
      return point ? [{ region_id: row.id, lat: point.lat, lon: point.lon, stage: row.stage, score: row.score }] : []
    })
    return { targets, via: `flags ${day}` }
  }
  log('[nasa_imerg] no risk_score flags for today; computing Layer-1 score in memory')
  const { runLayer1Score } = await import('../../score/job')
  const scored = await runLayer1Score(client, { dryRun: true, write: false, now, log: () => {} })
  const targets = scored.rows
    .filter((row) => row.stage >= 2 && row.lat != null && row.lon != null)
    .map((row) => ({ region_id: row.region_id, lat: row.lat as number, lon: row.lon as number, stage: row.stage, score: row.score }))
  return { targets, via: 'score dry-run' }
}

async function existingDays(
  client: SupabaseClient,
  regionIds: number[],
  since: string,
): Promise<Map<number, Map<string, { value: number; run: ImergRun }>>> {
  const out = new Map<number, Map<string, { value: number; run: ImergRun }>>()
  for (let i = 0; i < regionIds.length; i += 200) {
    const { data, error } = await client
      .from('crisis_region_metrics')
      .select('region_id, valid_time, value, detail, issued_at')
      .eq('metric', 'imerg_precip_1d')
      .in('region_id', regionIds.slice(i, i + 200))
      .gte('valid_time', since)
      .order('issued_at', { ascending: true })
    if (error) throw new Error(`imerg existing: ${error.message}`)
    for (const row of data ?? []) {
      const id = Number(row.region_id)
      const day = String(row.valid_time).slice(0, 10)
      const run: ImergRun = asRecord(row.detail)?.run === 'late' ? 'late' : 'early'
      const value = finiteNumber(row.value)
      if (value == null) continue
      const map = out.get(id) ?? new Map()
      const prev = map.get(day)
      if (!prev || prev.run === 'early') map.set(day, { value, run })
      out.set(id, map)
    }
  }
  return out
}

export const nasaImergSource: CrisisSource = {
  key: 'nasa_imerg',
  department: 'natural-hydro',
  scheduleMinutes: 24 * 60,
  writes: 'metrics',
  async fetch(ctx): Promise<IngestFetchResult> {
    let httpCalls = 0
    const auth = await earthdataBearer(ctx.env)
    httpCalls += auth.httpCalls
    if (!auth.token) return { httpCalls, error: auth.error ?? 'no Earthdata token' }

    const { targets: allTargets, via } = await stageTargets(ctx.client, ctx.now, ctx.log)
    const rain = await rainForecast(ctx.client, allTargets.map((row) => row.region_id), ctx.now)
    const targets = rankImergTargets(allTargets, rain).slice(0, IMERG_POINT_CAP)
    if (!targets.length) return { httpCalls, skipped: 'no stage >= 2 regions today' }

    const start = new Date(ctx.now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10)
    const end = ctx.now.toISOString().slice(0, 10)
    const granules: Record<ImergRun, Map<string, string>> = { late: new Map(), early: new Map() }
    for (const run of ['late', 'early'] as const) {
      const url = `${CMR_GRANULES}?short_name=${IMERG_PRODUCTS[run]}&version=07&temporal=${start}T00:00:00Z,${end}T23:59:59Z&sort_key=-start_date&page_size=10`
      const res = await politeFetch(url, { sourceKey: 'cmr', minIntervalMs: 500 })
      httpCalls += 1
      if (res.ok) granules[run] = imergGranules(res.data)
    }
    const picks = pickImergDays(granules.late, granules.early)
    if (!picks.length) return { httpCalls, error: 'CMR returned no IMERG daily granules' }
    const windowDays = picks.map((pick) => pick.day)

    const stored = ctx.dryRun ? new Map() : await existingDays(ctx.client, targets.map((row) => row.region_id), `${windowDays[windowDays.length - 1]}T00:00:00.000Z`)
    const jobs: Array<{ target: ImergTarget; pick: (typeof picks)[number] }> = []
    for (const target of targets) {
      for (const pick of picks) {
        const have = stored.get(target.region_id)?.get(pick.day)
        if (have && (have.run === 'late' || pick.run === 'early')) continue
        jobs.push({ target, pick })
      }
    }

    const cellCache = new Map<string, number | null>()
    const metrics: NormalizedMetric[] = []
    const issuedAt = ctx.now.toISOString()
    let failed = 0
    let cursor = 0
    const worker = async (slot: number) => {
      while (cursor < jobs.length) {
        const job = jobs[cursor]
        cursor += 1
        const { lonIndex, latIndex } = imergCell(job.target.lat, job.target.lon)
        const cellKey = `${job.pick.url}|${lonIndex}|${latIndex}`
        let value = cellCache.get(cellKey)
        if (value === undefined) {
          const res = await politeFetch(imergPointUrl(job.pick.url, job.target.lat, job.target.lon), {
            sourceKey: `nasa_imerg:${slot}`,
            minIntervalMs: 200,
            timeoutMs: 30_000,
            as: 'text',
            headers: { Authorization: `Bearer ${auth.token}` },
          })
          httpCalls += 1
          value = res.ok ? parseImergAscii(res.text) : null
          if (!res.ok) failed += 1
          cellCache.set(cellKey, value)
        }
        if (value == null) continue
        metrics.push({
          region_id: job.target.region_id,
          metric: 'imerg_precip_1d',
          valid_time: `${job.pick.day}T00:00:00.000Z`,
          issued_at: issuedAt,
          value,
          unit: 'mm',
          source: 'nasa_imerg',
          detail: { run: job.pick.run, product: IMERG_PRODUCTS[job.pick.run], lon_index: lonIndex, lat_index: latIndex },
        })
        const map = stored.get(job.target.region_id) ?? new Map()
        map.set(job.pick.day, { value, run: job.pick.run })
        stored.set(job.target.region_id, map)
      }
    }
    await Promise.all(Array.from({ length: Math.min(IMERG_WORKERS, Math.max(1, jobs.length)) }, (_, slot) => worker(slot)))

    let threeDay = 0
    for (const target of targets) {
      const total = threeDayTotal(stored.get(target.region_id) ?? new Map(), windowDays)
      if (!total) continue
      threeDay += 1
      metrics.push({
        region_id: target.region_id,
        metric: 'imerg_precip_3d',
        valid_time: `${windowDays[0]}T00:00:00.000Z`,
        issued_at: issuedAt,
        value: total.total,
        unit: 'mm',
        source: 'nasa_imerg',
        detail: { days: windowDays, runs: total.runs },
      })
    }
    if (!metrics.length && failed) return { httpCalls, error: `IMERG point reads failed (${failed}/${jobs.length})` }
    return {
      httpCalls,
      metrics,
      quotaNote: [
        `targets=${targets.length}/${allTargets.length} via ${via}`,
        `rain_forecast_high=${targets.filter((row) => (rain.get(row.region_id) ?? 0) >= OBSERVED_RAIN.forecastHigh).length}`,
        `auth=${auth.via}`,
        `days=${picks.map((pick) => `${pick.day}:${pick.run}`).join(',')}`,
        `reads=${jobs.length}`,
        `three_day=${threeDay}`,
        failed ? `failed=${failed}` : null,
      ].filter(Boolean).join('; '),
    }
  },
}
