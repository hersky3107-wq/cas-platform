import {
  estimateBilledCalls,
  OPENMETEO_BATCH_SIZE,
  OPENMETEO_COORD_DECIMALS,
  OPENMETEO_MAX_URL_CHARS,
  OPENMETEO_MINUTE_BILLED_CAP,
  recordBilledCalls,
  sleepMsForMinuteBudget,
  wouldExceedBudget,
} from '../budget'
import { asArray, asRecord, finiteNumber, politeFetch } from '../fetch'
import { addBilled, extrapolateCount, loadProviderQuota, providerAllowance, saveProviderQuota } from '../quota'
import { loadForecastRegions } from '../regions'
import { FIXED_SLOTS } from '../schedule'
import type { CrisisSource, ForecastRegion, IngestContext, IngestFetchResult, NormalizedForecast } from '../types'

const DAILY = 'precipitation_sum,temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,wind_speed_10m_max,soil_moisture_0_to_7cm_mean'
const GAP_MS = 2_000

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
  return gridUrl(
    'https://api.open-meteo.com/v1/forecast',
    `daily=${DAILY}&forecast_days=16&timezone=UTC&wind_speed_unit=ms`,
    regions,
  )
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

function dayStamp(raw: string): string {
  return raw.slice(0, 10)
}

export function buildOpenMeteoForecasts(
  payload: unknown,
  regions: ForecastRegion[],
  issuedAt: string,
): NormalizedForecast[] {
  const rows = Array.isArray(payload) ? payload : payload ? [payload] : []
  const issuedDate = issuedAt.slice(0, 10)
  const out: NormalizedForecast[] = []
  rows.forEach((item, index) => {
    const body = asRecord(item)
    const daily = asRecord(body?.daily)
    const region = regions[index]
    if (!daily || !region) return
    const dates = asArray(daily.time).map((value) => dayStamp(String(value)))
    const precip = asArray(daily.precipitation_sum).map((value) => finiteNumber(value))
    const tmax = asArray(daily.temperature_2m_max).map((value) => finiteNumber(value))
    const tmin = asArray(daily.temperature_2m_min).map((value) => finiteNumber(value))
    const rh = asArray(daily.relative_humidity_2m_mean).map((value) => finiteNumber(value))
    const wind = asArray(daily.wind_speed_10m_max).map((value) => finiteNumber(value))
    const soil = asArray(daily.soil_moisture_0_to_7cm_mean).map((value) => finiteNumber(value))
    if (!dates.length) return
    out.push({
      region_id: region.id,
      source: 'openmeteo_forecast',
      issued_date: issuedDate,
      issued_at: issuedAt,
      horizon_days: dates.length,
      series: {
        dates,
        precip_mm: precip,
        tmax_c: tmax,
        tmin_c: tmin,
        rh_mean_pct: rh,
        wind_max_ms: wind,
        soil_m3: soil,
      },
    })
  })
  return out
}

export const openmeteoForecastSource: CrisisSource = {
  key: 'openmeteo_forecast',
  department: 'hydro_weather',
  scheduleMinutes: 1440,
  fixedSchedule: FIXED_SLOTS.openmeteo_forecast,
  writes: 'forecasts',
  async fetch(ctx): Promise<IngestFetchResult> {
    return fetchOpenMeteoGrid(ctx, {
      key: 'openmeteo_forecast',
      loadRegions: loadForecastRegions,
      url: forecastUrl,
      normalize: buildOpenMeteoForecasts,
    })
  },
}

export async function fetchOpenMeteoGrid(
  ctx: IngestContext,
  opts: {
    key: 'openmeteo_forecast' | 'glofas'
    loadRegions: (client: IngestContext['client']) => Promise<ForecastRegion[]>
    url: (regions: ForecastRegion[]) => string
    normalize: (payload: unknown, regions: ForecastRegion[], issuedAt: string) => NormalizedForecast[]
    emptyNote?: string
  },
): Promise<IngestFetchResult> {
  const regions = await opts.loadRegions(ctx.client)
  if (!regions.length) {
    return { httpCalls: 0, skipped: opts.emptyNote ?? 'no forecast regions (load crisis_regions first)' }
  }

  const loaded = await loadProviderQuota(ctx.client, ctx.now)
  let ledger = loaded.ledger
  if (loaded.seeded) await saveProviderQuota(ctx.client, ledger)

  const allowance = providerAllowance(opts.key, ledger.billed_today)
  if (allowance <= 0) {
    return {
      httpCalls: 0,
      billedCalls: 0,
      skipped: `open-meteo combined daily cap reached (billed_today=${ledger.billed_today})`,
      quotaNote: `skipped; billed_today=${ledger.billed_today} date_utc=${ledger.date_utc}`,
    }
  }

  const issuedAt = ctx.now.toISOString()
  const forecasts: NormalizedForecast[] = []
  let httpCalls = 0
  let billed = 0
  const notes: string[] = []
  let minuteStamps: number[] = []
  let batchSize = OPENMETEO_BATCH_SIZE
  let partial = false
  let i = 0
  const locationBudget = ctx.dryRun ? Math.min(OPENMETEO_BATCH_SIZE, allowance, regions.length) : regions.length

  while (i < locationBudget) {
    const remaining = allowance - billed
    if (remaining <= 0) {
      notes.push(`provider allowance exhausted at ${i}/${regions.length}`)
      partial = true
      break
    }
    let batch = trimBatchToUrlLimit(
      regions.slice(i, i + Math.min(batchSize, remaining, locationBudget - i)),
      opts.url,
    )
    if (!batch.length) break
    const add = estimateBilledCalls(batch.length)
    if (wouldExceedBudget(billed, add, allowance)) {
      notes.push(`next batch of ${batch.length} would exceed allowance ${allowance}`)
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
      const retryWait = sleepMsForMinuteBudget(minuteStamps, estimateBilledCalls(batch.length))
      if (retryWait > 0) await sleep(retryWait)
      url = opts.url(batch)
      ctx.log(`[${opts.key}] retry n=${batch.length} url_len=${url.length}`)
      res = await politeFetch(url, { sourceKey: opts.key, minIntervalMs: GAP_MS })
      httpCalls += 1
      partial = true
    }

    if (!res.ok) {
      notes.push(res.error ?? `HTTP ${res.status}`)
      ledger = addBilled(ledger, billed)
      await saveProviderQuota(ctx.client, ledger)
      return {
        httpCalls,
        billedCalls: billed,
        forecasts,
        error: res.error ?? `HTTP ${res.status}`,
        quotaNote: notes.join('; ') || undefined,
      }
    }

    const usedAdd = estimateBilledCalls(batch.length)
    forecasts.push(...opts.normalize(res.data, batch, issuedAt))
    billed += usedAdd
    minuteStamps = recordBilledCalls(minuteStamps, usedAdd)
    i += batch.length
    if (ctx.dryRun) break
  }

  ledger = addBilled(ledger, billed)
  await saveProviderQuota(ctx.client, ledger)

  if (ctx.dryRun) {
    const extrapolated = extrapolateCount(forecasts.length, i, regions.length)
    ctx.log('dry-run sampled 1 batch')
    notes.unshift(`dry-run sampled 1 batch; sample_rows=${forecasts.length}; extrapolated_rows=${extrapolated}; billed_sample=${billed}`)
    return {
      httpCalls,
      billedCalls: billed,
      forecasts: [],
      reportedRows: extrapolated,
      quotaNote: notes.join('; '),
    }
  }

  if (i < regions.length) {
    partial = true
    notes.push(`stopped at ${i}/${regions.length} locations`)
  }

  return {
    httpCalls,
    billedCalls: billed,
    forecasts,
    quotaNote: notes.join('; ') || (partial ? 'partial' : undefined),
  }
}
