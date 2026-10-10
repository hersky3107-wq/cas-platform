import { estimateBilledCalls } from '../budget'
import { asArray, asRecord, finiteNumber, politeFetch } from '../fetch'
import { addBilled, climateAllowance, loadProviderQuota, saveProviderQuota } from '../quota'
import { loadForecastRegions } from '../regions'
import { climateFromDaily, type DailySample } from '../../climate/stats'
import type { CrisisSource, ForecastRegion, IngestContext, IngestFetchResult } from '../types'
import type { SupabaseClient } from '@supabase/supabase-js'

const DAILY = 'temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean,soil_moisture_0_to_7cm_mean'
const BATCH = 4
const GAP_MS = 2_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function archiveEnd(now: Date): string {
  return new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10)
}

export function archiveUrl(regions: ForecastRegion[], end: string): string {
  const lats = regions.map((row) => row.lat.toFixed(3)).join(',')
  const lons = regions.map((row) => row.lon.toFixed(3)).join(',')
  return (
    'https://archive-api.open-meteo.com/v1/archive?latitude=' +
    `${lats}&longitude=${lons}&start_date=2016-01-01&end_date=${end}` +
    `&daily=${DAILY}&timezone=UTC`
  )
}

function numList(value: unknown): Array<number | null> {
  return asArray(value).map((item) => finiteNumber(item))
}

export function samplesFromArchive(payload: unknown): DailySample[] {
  const body = asRecord(payload)
  const daily = asRecord(body?.daily)
  if (!daily) return []
  const dates = asArray(daily.time).map((value) => String(value).slice(0, 10))
  const tmax = numList(daily.temperature_2m_max)
  const tmin = numList(daily.temperature_2m_min)
  const precip = numList(daily.precipitation_sum)
  const soil = numList(daily.soil_moisture_0_to_7cm_mean)
  return dates.map((date, index) => ({
    date,
    tmax: tmax[index] ?? null,
    tmin: tmin[index] ?? null,
    precip: precip[index] ?? null,
    soil: soil[index] ?? null,
  }))
}

async function doneCounts(client: SupabaseClient): Promise<Map<number, number>> {
  const counts = new Map<number, number>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('crisis_region_climate')
      .select('region_id')
      .order('region_id', { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    for (const row of rows) counts.set(Number(row.region_id), (counts.get(Number(row.region_id)) ?? 0) + 1)
    if (rows.length < 1000) break
  }
  return counts
}

async function upsertNormals(
  client: SupabaseClient,
  regionId: number,
  normals: ReturnType<typeof climateFromDaily>,
): Promise<void> {
  const rows = normals.months.map((month) => ({
    region_id: regionId,
    month: month.month,
    tmax_p95: month.tmaxP95,
    tmax_p5: month.tmaxP5,
    tmin_p95: month.tminP95,
    tmin_p5: month.tminP5,
    tmax_mean: month.tmaxMean,
    tmin_mean: month.tminMean,
    precip_daily_mean: month.precipDailyMean,
    soil_mean: month.soilMean,
    precip_30d: normals.precip30d,
    precip_30d_base: normals.precip30dBase,
    precip_90d: normals.precip90d,
    precip_90d_base: normals.precip90dBase,
    soil_recent: normals.soilRecent,
    sample_days: month.sampleDays,
    computed_at: new Date().toISOString(),
  }))
  const { error } = await client.from('crisis_region_climate').upsert(rows, { onConflict: 'region_id,month' })
  if (error) throw new Error(error.message)
}

export const openmeteoClimateSource: CrisisSource = {
  key: 'openmeteo_climate',
  department: 'hydro_weather',
  scheduleMinutes: 1440,
  writes: 'signals',
  async fetch(ctx: IngestContext): Promise<IngestFetchResult> {
    const regions = await loadForecastRegions(ctx.client)
    let counts: Map<number, number>
    try {
      counts = await doneCounts(ctx.client)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { httpCalls: 0, skipped: `crisis_region_climate unavailable: ${message}` }
    }
    const pending = regions.filter((row) => (counts.get(row.id) ?? 0) < 12)
    const loaded = await loadProviderQuota(ctx.client, ctx.now)
    let ledger = loaded.ledger
    if (loaded.seeded) await saveProviderQuota(ctx.client, ledger)
    const allowance = climateAllowance(ledger.billed_today)
    const note = `climate_done=${regions.length - pending.length}/${regions.length} allowance=${allowance} billed_today=${ledger.billed_today}`
    ctx.log(`[openmeteo_climate] ${note}`)
    if (!pending.length) return { httpCalls: 0, signals: [], quotaNote: `${note}; complete` }
    if (allowance <= 0) {
      return { httpCalls: 0, skipped: 'waiting for forecast budget or daily headroom', quotaNote: note }
    }
    const slice = pending.slice(0, allowance)
    const end = archiveEnd(ctx.now)
    let httpCalls = 0
    let billed = 0
    let written = 0
    const errors: string[] = []
    for (let i = 0; i < slice.length; i += BATCH) {
      const batch = slice.slice(i, i + BATCH)
      if (i > 0) await sleep(GAP_MS)
      const res = await politeFetch(archiveUrl(batch, end), {
        sourceKey: 'openmeteo_climate',
        minIntervalMs: GAP_MS,
        timeoutMs: 90_000,
      })
      httpCalls += 1
      if (!res.ok) {
        errors.push(res.error ?? `HTTP ${res.status}`)
        break
      }
      const bodies = Array.isArray(res.data) ? res.data : [res.data]
      for (let n = 0; n < batch.length; n += 1) {
        const samples = samplesFromArchive(bodies[n])
        if (samples.length < 300) {
          errors.push(`${batch[n].id} short series ${samples.length}`)
          continue
        }
        await upsertNormals(ctx.client, batch[n].id, climateFromDaily(samples))
        written += 12
      }
      billed += estimateBilledCalls(batch.length)
      ctx.log(`[openmeteo_climate] batch ${i + batch.length}/${slice.length} written_regions=${written / 12}`)
    }
    ledger = addBilled(ledger, billed)
    await saveProviderQuota(ctx.client, ledger)
    return {
      httpCalls,
      billedCalls: billed,
      signals: [],
      reportedRows: written,
      error: errors.length && written === 0 ? errors[0] : undefined,
      quotaNote: `${note}; this_run=${slice.length}; rows=${written}${errors.length ? `; ${errors.slice(0, 3).join('; ')}` : ''}`,
    }
  },
}
