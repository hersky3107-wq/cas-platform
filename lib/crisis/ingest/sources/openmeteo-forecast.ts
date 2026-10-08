import {
  billedCallsToday,
  estimateBilledCalls,
  OPENMETEO_DAILY_BILLED_CAP,
  remainingBudget,
  wouldExceedBudget,
} from '../budget'
import { asArray, asRecord, finiteNumber, politeFetch } from '../fetch'
import { loadForecastRegions, loadStateSafe } from '../regions'
import type { CrisisSource, ForecastRegion, IngestContext, IngestFetchResult, NormalizedMetric } from '../types'

const DAILY = 'precipitation_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max'
const BATCH = 500
const GAP_MS = 10_000

const METRICS = [
  { field: 'precipitation_sum', metric: 'precipitation_sum', unit: 'mm' },
  { field: 'temperature_2m_max', metric: 'temperature_2m_max', unit: 'C' },
  { field: 'temperature_2m_min', metric: 'temperature_2m_min', unit: 'C' },
  { field: 'wind_speed_10m_max', metric: 'wind_speed_10m_max', unit: 'km/h' },
] as const

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function forecastUrl(regions: ForecastRegion[]): string {
  const lats = regions.map((r) => r.lat.toFixed(4)).join(',')
  const lons = regions.map((r) => r.lon.toFixed(4)).join(',')
  return `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&daily=${DAILY}&forecast_days=7&timezone=UTC`
}

export function normalizeOpenMeteoForecast(
  payload: unknown,
  regions: ForecastRegion[],
  issuedAt: string,
): NormalizedMetric[] {
  const rows = Array.isArray(payload) ? payload : payload ? [payload] : []
  const out: NormalizedMetric[] = []
  rows.forEach((item, index) => {
    const body = asRecord(item)
    const daily = asRecord(body?.daily)
    if (!daily) return
    const times = asArray(daily.time).map(String)
    const region = regions[index]
    if (!region) return
    for (let i = 0; i < times.length; i += 1) {
      const valid = times[i].includes('T') ? new Date(times[i]).toISOString() : `${times[i]}T00:00:00.000Z`
      for (const spec of METRICS) {
        const value = finiteNumber(asArray(daily[spec.field])[i])
        if (value == null) continue
        out.push({
          region_id: region.id,
          metric: spec.metric,
          valid_time: valid,
          issued_at: issuedAt,
          value,
          unit: spec.unit,
          source: 'openmeteo_forecast',
        })
      }
    }
  })
  return out
}

export const openmeteoForecastSource: CrisisSource = {
  key: 'openmeteo_forecast',
  department: 'hydro_weather',
  scheduleMinutes: 1440,
  writes: 'metrics',
  async fetch(ctx): Promise<IngestFetchResult> {
    return fetchOpenMeteoGrid(ctx, {
      key: 'openmeteo_forecast',
      cap: OPENMETEO_DAILY_BILLED_CAP,
      loadRegions: loadForecastRegions,
      url: forecastUrl,
      normalize: normalizeOpenMeteoForecast,
    })
  },
}

export async function fetchOpenMeteoGrid(
  ctx: IngestContext,
  opts: {
    key: 'openmeteo_forecast' | 'glofas'
    cap: number
    loadRegions: (client: IngestContext['client']) => Promise<ForecastRegion[]>
    url: (regions: ForecastRegion[]) => string
    normalize: (payload: unknown, regions: ForecastRegion[], issuedAt: string) => NormalizedMetric[]
    extra?: (metrics: NormalizedMetric[], ctx: IngestContext, regions: ForecastRegion[]) => Promise<NormalizedMetric[]>
    emptyNote?: string
  },
): Promise<IngestFetchResult> {
  const regions = await opts.loadRegions(ctx.client)
  if (!regions.length) {
    return { httpCalls: 0, skipped: opts.emptyNote ?? 'no forecast regions (load crisis_regions first)' }
  }

  const state = await loadStateSafe(ctx.client, opts.key)
  let used = billedCallsToday(state?.cursor ?? null, ctx.now)
  const issuedAt = ctx.now.toISOString()
  const metrics: NormalizedMetric[] = []
  let httpCalls = 0
  let billed = 0
  const notes: string[] = []

  for (let i = 0; i < regions.length; i += BATCH) {
    const remaining = remainingBudget(used, opts.cap)
    if (remaining <= 0) {
      notes.push(`daily billed-call cap ${opts.cap} reached; stopped at ${i}/${regions.length} locations`)
      break
    }
    const take = Math.min(BATCH, regions.length - i, remaining)
    const batch = regions.slice(i, i + take)
    const add = estimateBilledCalls(batch.length)
    if (wouldExceedBudget(used, add, opts.cap)) {
      notes.push(`next batch of ${batch.length} would exceed cap ${opts.cap} (used ${used})`)
      break
    }
    if (httpCalls > 0) await sleep(GAP_MS)
    const res = await politeFetch(opts.url(batch), { sourceKey: opts.key, minIntervalMs: GAP_MS })
    httpCalls += 1
    if (!res.ok) {
      return {
        httpCalls,
        billedCalls: billed,
        metrics,
        error: res.error ?? `HTTP ${res.status}`,
        quotaNote: notes.join('; ') || undefined,
      }
    }
    metrics.push(...opts.normalize(res.data, batch, issuedAt))
    used += add
    billed += add
  }

  const extra = opts.extra ? await opts.extra(metrics, ctx, regions) : []

  return {
    httpCalls,
    billedCalls: billed,
    metrics: metrics.concat(extra),
    quotaNote: notes.join('; ') || undefined,
  }
}
