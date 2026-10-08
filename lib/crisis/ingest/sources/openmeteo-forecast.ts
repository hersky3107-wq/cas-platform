import {
  billedCallsToday,
  estimateBilledCalls,
  OPENMETEO_BATCH_SIZE,
  OPENMETEO_COORD_DECIMALS,
  OPENMETEO_DAILY_BILLED_CAP,
  OPENMETEO_MAX_URL_CHARS,
  OPENMETEO_MINUTE_BILLED_CAP,
  recordBilledCalls,
  remainingBudget,
  sleepMsForMinuteBudget,
  wouldExceedBudget,
} from '../budget'
import { asArray, asRecord, finiteNumber, politeFetch } from '../fetch'
import { loadForecastRegions, loadStateSafe } from '../regions'
import type { CrisisSource, ForecastRegion, IngestContext, IngestFetchResult, NormalizedMetric } from '../types'

const DAILY = 'precipitation_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max'
const GAP_MS = 2_000

const METRICS = [
  { field: 'precipitation_sum', metric: 'precipitation_sum', unit: 'mm' },
  { field: 'temperature_2m_max', metric: 'temperature_2m_max', unit: 'C' },
  { field: 'temperature_2m_min', metric: 'temperature_2m_min', unit: 'C' },
  { field: 'wind_speed_10m_max', metric: 'wind_speed_10m_max', unit: 'km/h' },
] as const

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function formatCoord(n: number): string {
  return n.toFixed(OPENMETEO_COORD_DECIMALS)
}

export function gridUrl(base: string, extra: string, regions: ForecastRegion[]): string {
  const lats = regions.map((r) => formatCoord(r.lat)).join(',')
  const lons = regions.map((r) => formatCoord(r.lon)).join(',')
  return `${base}?latitude=${lats}&longitude=${lons}&${extra}`
}

export function forecastUrl(regions: ForecastRegion[]): string {
  return gridUrl('https://api.open-meteo.com/v1/forecast', `daily=${DAILY}&forecast_days=7&timezone=UTC`, regions)
}

/** Shrink a batch until the GET URL is under the length cap (414 guard). */
export function trimBatchToUrlLimit(
  regions: ForecastRegion[],
  buildUrl: (batch: ForecastRegion[]) => string,
  maxChars = OPENMETEO_MAX_URL_CHARS,
): ForecastRegion[] {
  let batch = regions
  while (batch.length > 1 && buildUrl(batch).length > maxChars) {
    batch = batch.slice(0, Math.max(1, Math.floor(batch.length / 2)))
  }
  return batch
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
  let minuteStamps: number[] = []
  let batchSize = OPENMETEO_BATCH_SIZE
  let partial = false
  let i = 0

  while (i < regions.length) {
    const remaining = remainingBudget(used, opts.cap)
    if (remaining <= 0) {
      notes.push(`daily billed-call cap ${opts.cap} reached; stopped at ${i}/${regions.length} locations`)
      partial = true
      break
    }
    let batch = trimBatchToUrlLimit(regions.slice(i, i + Math.min(batchSize, remaining, regions.length - i)), opts.url)
    if (!batch.length) break
    const add = estimateBilledCalls(batch.length)
    if (wouldExceedBudget(used, add, opts.cap)) {
      notes.push(`next batch of ${batch.length} would exceed cap ${opts.cap} (used ${used})`)
      partial = true
      break
    }

    const minuteWait = sleepMsForMinuteBudget(minuteStamps, add)
    if (minuteWait > 0) {
      ctx.log(`[${opts.key}] rolling-minute billed cap ${OPENMETEO_MINUTE_BILLED_CAP}; sleeping ${minuteWait}ms`)
      await sleep(minuteWait)
    }
    if (httpCalls > 0) await sleep(GAP_MS)

    let url = opts.url(batch)
    ctx.log(`[${opts.key}] batch n=${batch.length} url_len=${url.length} at=${i}/${regions.length}`)
    let res = await politeFetch(url, { sourceKey: opts.key, minIntervalMs: GAP_MS })
    httpCalls += 1

    if ((res.status === 414 || res.status === 429) && batch.length > 1) {
      batch = trimBatchToUrlLimit(batch.slice(0, Math.max(1, Math.floor(batch.length / 2))), opts.url)
      if (res.status === 414) batchSize = Math.min(batchSize, batch.length)
      notes.push(`HTTP ${res.status}; retry once with n=${batch.length}`)
      if (res.status === 429) await sleep(10_000)
      const retryAdd = estimateBilledCalls(batch.length)
      const retryWait = sleepMsForMinuteBudget(minuteStamps, retryAdd)
      if (retryWait > 0) await sleep(retryWait)
      url = opts.url(batch)
      ctx.log(`[${opts.key}] retry n=${batch.length} url_len=${url.length}`)
      res = await politeFetch(url, { sourceKey: opts.key, minIntervalMs: GAP_MS })
      httpCalls += 1
      partial = true
    }

    if (!res.ok) {
      notes.push(res.error ?? `HTTP ${res.status}`)
      return {
        httpCalls,
        billedCalls: billed,
        metrics,
        error: res.error ?? `HTTP ${res.status}`,
        quotaNote: notes.join('; ') || undefined,
      }
    }

    const usedAdd = estimateBilledCalls(batch.length)
    metrics.push(...opts.normalize(res.data, batch, issuedAt))
    used += usedAdd
    billed += usedAdd
    minuteStamps = recordBilledCalls(minuteStamps, usedAdd)
    i += batch.length
  }

  const extra = opts.extra ? await opts.extra(metrics, ctx, regions) : []
  if (partial && i < regions.length && !notes.some((n) => /cap|HTTP/.test(n))) {
    notes.push(`partial: wrote through ${i}/${regions.length} locations`)
  }

  return {
    httpCalls,
    billedCalls: billed,
    metrics: metrics.concat(extra),
    quotaNote: notes.join('; ') || (partial ? 'partial' : undefined),
  }
}
