import { asArray, asRecord, finiteNumber } from '../fetch'
import { loadDischargeMeans, loadHighInformRegions } from '../regions'
import { FIXED_SLOTS } from '../schedule'
import type { CrisisSource, ForecastRegion, IngestFetchResult, NormalizedForecast } from '../types'
import { fetchOpenMeteoGrid, gridUrl } from './openmeteo-forecast'

export function glofasUrl(regions: ForecastRegion[]): string {
  return gridUrl('https://flood-api.open-meteo.com/v1/flood', 'daily=river_discharge&forecast_days=7', regions)
}

export function dischargeRatios(values: Array<number | null>, mean: number | null | undefined): Array<number | null> {
  if (mean == null || !Number.isFinite(mean) || mean === 0) return values.map(() => null)
  return values.map((value) => (value == null ? null : value / mean))
}

export function buildGlofasForecasts(
  payload: unknown,
  regions: ForecastRegion[],
  issuedAt: string,
  means: Map<number, number> = new Map(),
): NormalizedForecast[] {
  const rows = Array.isArray(payload) ? payload : payload ? [payload] : []
  const issuedDate = issuedAt.slice(0, 10)
  const out: NormalizedForecast[] = []
  rows.forEach((item, index) => {
    const body = asRecord(item)
    const daily = asRecord(body?.daily)
    const region = regions[index]
    if (!daily || !region) return
    const dates = asArray(daily.time).map((value) => String(value).slice(0, 10))
    const discharge = asArray(daily.river_discharge).map((value) => finiteNumber(value))
    if (!dates.length) return
    out.push({
      region_id: region.id,
      source: 'glofas',
      issued_date: issuedDate,
      issued_at: issuedAt,
      horizon_days: dates.length,
      series: {
        dates,
        discharge_m3s: discharge,
        ratio_to_30d_mean: dischargeRatios(discharge, means.get(region.id)),
      },
    })
  })
  return out
}

export const glofasSource: CrisisSource = {
  key: 'glofas',
  department: 'hydro_weather',
  scheduleMinutes: 1440,
  fixedSchedule: FIXED_SLOTS.glofas,
  writes: 'forecasts',
  async fetch(ctx): Promise<IngestFetchResult> {
    const highInform = await loadHighInformRegions(ctx.client, 0.5)
    if (!highInform.length) {
      return { httpCalls: 0, skipped: 'no INFORM risk scores — run inform / backfill-inform first' }
    }
    const means = await loadDischargeMeans(ctx.client)
    return fetchOpenMeteoGrid(ctx, {
      key: 'glofas',
      loadRegions: async () => highInform,
      url: glofasUrl,
      normalize: (payload, regions, issuedAt) => buildGlofasForecasts(payload, regions, issuedAt, means),
    })
  },
}
