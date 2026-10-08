import { buildRegionIndex, loadForecastRegions, matchRegion } from '../regions'
import { asRecord, finiteNumber, isoTime, politeFetch } from '../fetch'
import { toIso3 } from '../iso'
import type { CrisisSource, ForecastRegion, IngestFetchResult, NormalizedMetric } from '../types'

const ROOT = 'https://fdw.fews.net/api/ipcphase/'

function collectionCandidates(now: Date): string[] {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const dates: string[] = []
  for (let i = 0; i < 8; i += 1) {
    const d = new Date(Date.UTC(y, m - i * 1, 1))
    dates.push(d.toISOString().slice(0, 10))
  }
  // Outlook cycles often land on Jun/Oct/Feb
  for (const month of [5, 9, 1]) {
    dates.push(`${y}-${String(month + 1).padStart(2, '0')}-01`)
    dates.push(`${y - 1}-${String(month + 1).padStart(2, '0')}-01`)
  }
  return [...new Set(dates)]
}

function rowsFrom(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  const rec = asRecord(data)
  if (Array.isArray(rec?.results)) return rec.results
  if (Array.isArray(rec?.features)) return rec.features
  return []
}

export function normalizeFewsnetRows(
  rows: unknown[],
  regions: ForecastRegion[],
  issuedAt: string,
): { metrics: NormalizedMetric[]; unmatched: string[] } {
  const index = buildRegionIndex(regions)
  const metrics: NormalizedMetric[] = []
  const unmatched: string[] = []

  for (const item of rows) {
    const rec = asRecord(item)
    const props = rec?.properties ? asRecord(rec.properties) ?? rec : rec
    if (!props) continue
    const iso3 = toIso3(typeof props.iso3 === 'string' ? props.iso3 : typeof props.country_code === 'string' ? props.country_code : null)
    const names = [
      typeof props.geographic_unit_name === 'string' ? props.geographic_unit_name : null,
      typeof props.geographic_unit_full_name === 'string' ? props.geographic_unit_full_name.split(',')[0] : null,
      typeof props.country === 'string' ? props.country : null,
    ]
    const region = matchRegion(index, { iso3, names })
    const scenario = String(props.scenario ?? 'ML1').trim().toUpperCase()
    const metric = scenario === 'ML2' ? 'ipc_ml2' : 'ipc_ml1'
    const value = finiteNumber(props.value ?? props.phase ?? props.ipc_phase)
    const valid = isoTime(props.reporting_date ?? props.collection_date ?? props.projection_start) ?? issuedAt
    if (!region || value == null) {
      unmatched.push(`${iso3 ?? props.country_code ?? '?'} ${names.filter(Boolean).join(' / ') || props.fnid || 'row'}`)
      continue
    }
    metrics.push({
      region_id: region.id,
      metric,
      valid_time: valid,
      issued_at: issuedAt,
      value,
      unit: 'ipc_phase',
      source: 'fewsnet',
    })
  }

  return { metrics, unmatched }
}

export const fewsnetSource: CrisisSource = {
  key: 'fewsnet',
  department: 'hydro_weather',
  scheduleMinutes: 10_080,
  writes: 'metrics',
  async fetch(ctx): Promise<IngestFetchResult> {
    const regions = await loadForecastRegions(ctx.client)
    if (!regions.length) return { httpCalls: 0, skipped: 'no crisis_regions' }

    let httpCalls = 0
    const collected: unknown[] = []
    let lastError: string | undefined

    for (const scenario of ['ML1', 'ML2'] as const) {
      let got = false
      for (const date of collectionCandidates(ctx.now)) {
        const first = `${ROOT}?format=json&limit=500&scenario=${scenario}&collection_date=${date}`
        let url: string | null = first
        let pages = 0
        while (url && pages < 30) {
          const res = await politeFetch(url, { sourceKey: 'fewsnet', minIntervalMs: 1500 })
          httpCalls += 1
          pages += 1
          if (!res.ok) {
            lastError = res.error ?? `HTTP ${res.status}`
            break
          }
          const rows = rowsFrom(res.data)
          if (!rows.length) break
          collected.push(...rows)
          got = true
          const rec = asRecord(res.data)
          url = typeof rec?.next === 'string' ? rec.next : null
        }
        if (got) break
      }
    }

    if (!collected.length) {
      return { httpCalls, error: lastError ?? 'no FEWS NET IPC rows for recent collection dates' }
    }

    const { metrics, unmatched } = normalizeFewsnetRows(collected, regions, ctx.now.toISOString())
    if (unmatched.length) {
      ctx.log(`[fewsnet] unmatched ${unmatched.length} e.g. ${unmatched.slice(0, 8).join(' | ')}`)
    }
    return {
      httpCalls,
      metrics,
      unmatched,
      quotaNote: unmatched.length ? `${unmatched.length} unmatched name/country rows` : undefined,
    }
  },
}
