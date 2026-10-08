import { GLOFAS_DAILY_BILLED_CAP } from '../budget'
import { asArray, asRecord, finiteNumber } from '../fetch'
import { loadDischargeMeans, loadHighInformRegions } from '../regions'
import type { CrisisSource, ForecastRegion, IngestFetchResult, NormalizedMetric } from '../types'
import { fetchOpenMeteoGrid } from './openmeteo-forecast'

export function glofasUrl(regions: ForecastRegion[]): string {
  const lats = regions.map((r) => r.lat.toFixed(4)).join(',')
  const lons = regions.map((r) => r.lon.toFixed(4)).join(',')
  return `https://flood-api.open-meteo.com/v1/flood?latitude=${lats}&longitude=${lons}&daily=river_discharge&forecast_days=7`
}

export function normalizeGlofas(payload: unknown, regions: ForecastRegion[], issuedAt: string): NormalizedMetric[] {
  const rows = Array.isArray(payload) ? payload : payload ? [payload] : []
  const out: NormalizedMetric[] = []
  rows.forEach((item, index) => {
    const body = asRecord(item)
    const daily = asRecord(body?.daily)
    if (!daily) return
    const times = asArray(daily.time).map(String)
    const values = asArray(daily.river_discharge)
    const region = regions[index]
    if (!region) return
    for (let i = 0; i < times.length; i += 1) {
      const value = finiteNumber(values[i])
      if (value == null) continue
      const valid = times[i].includes('T') ? new Date(times[i]).toISOString() : `${times[i]}T00:00:00.000Z`
      out.push({
        region_id: region.id,
        metric: 'river_discharge',
        valid_time: valid,
        issued_at: issuedAt,
        value,
        unit: 'm3/s',
        source: 'glofas',
      })
    }
  })
  return out
}

export function withDischargeRatio(
  metrics: NormalizedMetric[],
  means: Map<number, number>,
): NormalizedMetric[] {
  const extra: NormalizedMetric[] = []
  for (const row of metrics) {
    if (row.metric !== 'river_discharge') continue
    const mean = means.get(row.region_id)
    if (mean == null || mean === 0 || !Number.isFinite(mean)) continue
    extra.push({
      ...row,
      metric: 'river_discharge_vs_30d_mean',
      value: row.value / mean,
      unit: 'ratio',
    })
  }
  return extra
}

export const glofasSource: CrisisSource = {
  key: 'glofas',
  department: 'hydro_weather',
  scheduleMinutes: 1440,
  writes: 'metrics',
  async fetch(ctx): Promise<IngestFetchResult> {
    const highInform = await loadHighInformRegions(ctx.client, 0.5)
    if (!highInform.length) {
      return { httpCalls: 0, skipped: 'no INFORM risk scores — run inform / backfill-inform first' }
    }
    return fetchOpenMeteoGrid(ctx, {
      key: 'glofas',
      cap: GLOFAS_DAILY_BILLED_CAP,
      loadRegions: async () => highInform,
      url: glofasUrl,
      normalize: normalizeGlofas,
      extra: async (metrics) => {
        const means = await loadDischargeMeans(ctx.client)
        return withDischargeRatio(metrics, means)
      },
    })
  },
}
