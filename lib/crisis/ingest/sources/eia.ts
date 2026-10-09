import { asArray, asRecord, finiteNumber, politeFetch } from '../fetch'
import type { CrisisSource, IngestFetchResult, NormalizedGlobalMetric } from '../types'

/** EIA API v2 petroleum spot prices (https://www.eia.gov/opendata/). */
export const EIA_SPOT_URL = 'https://api.eia.gov/v2/petroleum/pri/spt/data/'
export const EIA_SERIES: Record<string, string> = {
  RBRTE: 'brent_usd',
  RWTC: 'wti_usd',
}
/** Two series, about 45 trading days each, so the score can show a 30-day change. */
export const EIA_ROWS = 90

export function eiaUrl(key: string): string {
  const qs = [
    `api_key=${encodeURIComponent(key)}`,
    'frequency=daily',
    'data[0]=value',
    ...Object.keys(EIA_SERIES).map((series) => `facets[series][]=${series}`),
    'sort[0][column]=period',
    'sort[0][direction]=desc',
    `length=${EIA_ROWS}`,
  ].join('&')
  return `${EIA_SPOT_URL}?${qs}`
}

export function normalizeEiaSpot(payload: unknown, issuedAt: string): NormalizedGlobalMetric[] {
  const out: NormalizedGlobalMetric[] = []
  for (const item of asArray(asRecord(asRecord(payload)?.response)?.data)) {
    const row = asRecord(item)
    const series = typeof row?.series === 'string' ? row.series : ''
    const metric = EIA_SERIES[series]
    const period = typeof row?.period === 'string' ? row.period : ''
    const value = finiteNumber(row?.value)
    if (!metric || !/^\d{4}-\d{2}-\d{2}$/.test(period) || value == null) continue
    out.push({
      metric,
      valid_time: `${period}T00:00:00.000Z`,
      issued_at: issuedAt,
      value,
      unit: 'usd_per_bbl',
      source: 'eia',
      detail: { series, description: typeof row?.['series-description'] === 'string' ? row['series-description'] : null },
    })
  }
  return out
}

export const eiaSource: CrisisSource = {
  key: 'eia',
  department: 'infrastructure-economy',
  scheduleMinutes: 24 * 60,
  writes: 'metrics',
  requiredEnv: ['EIA_API_KEY'],
  async fetch(ctx): Promise<IngestFetchResult> {
    const res = await politeFetch(eiaUrl(ctx.env.EIA_API_KEY?.trim() ?? ''), { sourceKey: 'eia', minIntervalMs: 1000 })
    if (!res.ok) return { httpCalls: 1, error: `eia HTTP ${res.status}` }
    const rows = normalizeEiaSpot(res.data, ctx.now.toISOString())
    const latest = Object.values(EIA_SERIES).map((metric) => {
      const row = rows.find((item) => item.metric === metric)
      return row ? `${metric}=${row.value}@${row.valid_time.slice(0, 10)}` : `${metric}=none`
    })
    return { httpCalls: 1, globalMetrics: rows, quotaNote: [`n=${rows.length}`, ...latest].join('; ') }
  },
}
