import { asArray, asRecord, finiteNumber, isoTime, politeFetch } from '../fetch'
import { loadAllRegions } from '../regions'
import type { CrisisSource, IngestFetchResult, NormalizedMetric } from '../types'

const API = 'https://drmkc.jrc.ec.europa.eu/inform-index/API/InformAPI'
const HEADERS = { Accept: 'application/json', 'User-Agent': 'AIMANI-CrisisIngest/2B1' }

const INDICATORS: Array<{ id: string; metrics: string[] }> = [
  { id: 'INFORM', metrics: ['inform_risk'] },
  { id: 'HA', metrics: ['inform_hazard', 'inform_exposure'] },
  { id: 'VU', metrics: ['inform_vulnerability'] },
  { id: 'CC', metrics: ['inform_coping'] },
]

function workflowIdFrom(data: unknown): number | null {
  const rec = asRecord(data)
  if (!rec) {
    if (Array.isArray(data) && data[0]) return workflowIdFrom(data[0])
    return null
  }
  const direct = finiteNumber(rec.WorkflowId ?? rec.Id ?? rec.workflowId)
  if (direct != null) return direct
  if (Array.isArray(rec.data)) return workflowIdFrom(rec.data[0])
  return null
}

function publicationDate(meta: unknown, fallback: Date): string {
  const rec = asRecord(meta)
  const raw = rec?.FlagGnaPublished ?? rec?.FlagDataSaved ?? rec?.WorkflowDate ?? rec?.GNAFromDate
  return isoTime(raw) ?? fallback.toISOString()
}

export function normalizeInformScores(
  rows: unknown[],
  metric: string,
  countryRegionByIso3: Map<string, number>,
  validTime: string,
  issuedAt: string,
): NormalizedMetric[] {
  const out: NormalizedMetric[] = []
  for (const item of rows) {
    const row = asRecord(item)
    if (!row) continue
    const iso3 = String(row.Iso3 ?? row.iso3 ?? '').toUpperCase()
    const regionId = countryRegionByIso3.get(iso3)
    const value = finiteNumber(row.IndicatorScore ?? row.indicatorScore ?? row.Score)
    if (regionId == null || value == null) continue
    out.push({
      region_id: regionId,
      metric,
      valid_time: validTime,
      issued_at: issuedAt,
      value,
      unit: 'index_0_10',
      source: 'inform',
    })
  }
  return out
}

export async function resolveInformWorkflow(
  fetchFn: typeof politeFetch,
  year: number,
): Promise<{ workflowId: number | null; meta: unknown; httpCalls: number; error?: string }> {
  let httpCalls = 0
  const def = await fetchFn(`${API}/Workflows/Default?system=INFORM&year=${year}`, {
    sourceKey: 'inform',
    minIntervalMs: 1500,
    headers: HEADERS,
  })
  httpCalls += 1
  let workflowId = workflowIdFrom(def.data)
  let meta: unknown = def.data
  if (!workflowId) {
    const yearRes = await fetchFn(`${API}/Workflows/GetByYear?id=${year}`, {
      sourceKey: 'inform',
      minIntervalMs: 1500,
      headers: HEADERS,
    })
    httpCalls += 1
    const list = asArray(yearRes.data)
    const global =
      list.find((item) => /INFORM Risk/i.test(String(asRecord(item)?.Name ?? asRecord(item)?.WorkflowGroupName ?? ''))) ??
      list[0]
    workflowId = workflowIdFrom(global)
    meta = global ?? yearRes.data
  }
  if (!workflowId) {
    return { workflowId: null, meta, httpCalls, error: 'could not resolve INFORM WorkflowId' }
  }
  return { workflowId, meta, httpCalls }
}

export const informSource: CrisisSource = {
  key: 'inform',
  department: 'hydro_weather',
  scheduleMinutes: 43_200,
  writes: 'metrics',
  async fetch(ctx): Promise<IngestFetchResult> {
    const year = ctx.now.getUTCFullYear()
    const resolved = await resolveInformWorkflow(politeFetch, year)
    if (!resolved.workflowId) {
      return { httpCalls: resolved.httpCalls, error: resolved.error }
    }

    const allRegions = await loadAllRegions(ctx.client)
    const countryRegionByIso3 = new Map<string, number>()
    for (const row of allRegions) {
      if (row.level === 0 && row.iso3) countryRegionByIso3.set(row.iso3.toUpperCase(), Number(row.id))
    }
    if (!countryRegionByIso3.size) {
      return { httpCalls: resolved.httpCalls, skipped: 'no country regions — load crisis_regions first' }
    }

    const validTime = publicationDate(resolved.meta, ctx.now)
    const issuedAt = ctx.now.toISOString()
    const metrics: NormalizedMetric[] = []
    let httpCalls = resolved.httpCalls
    for (const spec of INDICATORS) {
      const url = `${API}/countries/Scores?workflowid=${resolved.workflowId}&indicatorId=${spec.id}`
      const res = await politeFetch(url, { sourceKey: 'inform', minIntervalMs: 1500, headers: HEADERS })
      httpCalls += 1
      if (!res.ok) {
        return { httpCalls, metrics, error: res.error ?? `HTTP ${res.status}` }
      }
      const rows = Array.isArray(res.data) ? res.data : asArray(asRecord(res.data)?.data)
      for (const metric of spec.metrics) {
        metrics.push(...normalizeInformScores(rows, metric, countryRegionByIso3, validTime, issuedAt))
      }
    }

    return { httpCalls, metrics }
  },
}
