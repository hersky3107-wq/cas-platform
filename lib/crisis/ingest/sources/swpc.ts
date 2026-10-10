import { politeFetch } from '../fetch'
import { forecastGeomagneticG } from '../../score/more-hazards'
import type { CrisisSource, IngestFetchResult } from '../types'

export const SWPC_FORECAST_URL = 'https://services.swpc.noaa.gov/text/3-day-forecast.txt'

export const swpcSource: CrisisSource = {
  key: 'swpc',
  department: 'natural',
  scheduleMinutes: 180,
  writes: 'metrics',
  async fetch(ctx): Promise<IngestFetchResult> {
    const res = await politeFetch(SWPC_FORECAST_URL, { sourceKey: 'swpc', minIntervalMs: 1000, as: 'text' })
    if (!res.ok) return { httpCalls: 1, error: res.error ?? `HTTP ${res.status}` }
    const g = forecastGeomagneticG(res.text)
    return {
      httpCalls: 1,
      globalMetrics: [{
        metric: 'geomagnetic_g',
        valid_time: ctx.now.toISOString(),
        issued_at: ctx.now.toISOString(),
        value: g,
        unit: 'noaa_g_scale',
        source: 'swpc',
        detail: { horizon: '3-day' },
      }],
      quotaNote: `g=${g}`,
    }
  },
}
