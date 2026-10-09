import { buildDedupeKey } from '../dedupe'
import { politeFetch } from '../fetch'
import type { CrisisSource, IngestFetchResult, NormalizedGlobalMetric, NormalizedSignal } from '../types'

export const ENSO_DISCUSSION = 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml'
export const ENSO_INDEX = 'https://www.cpc.ncep.noaa.gov/data/indices/sstoi.indices'

const STATUS_PATTERNS: Array<{ status: string; pattern: RegExp }> = [
  { status: 'El Niño Advisory', pattern: /El Ni(?:ñ|n)o Advisory/i },
  { status: 'La Niña Advisory', pattern: /La Ni(?:ñ|n)a Advisory/i },
  { status: 'El Niño Watch', pattern: /El Ni(?:ñ|n)o Watch/i },
  { status: 'La Niña Watch', pattern: /La Ni(?:ñ|n)a Watch/i },
]

export function parseEnsoStatus(html: string): string {
  const text = html.replace(/&ntilde;/gi, 'ñ').replace(/<[^>]+>/g, ' ')
  for (const row of STATUS_PATTERNS) {
    if (row.pattern.test(text)) return row.status
  }
  if (/ENSO[-\s]?neutral/i.test(text)) return 'ENSO-neutral'
  return 'unspecified'
}

export function parseNino34(text: string): { year: number; month: number; anomaly: number } | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parts = lines[i].split(/\s+/)
    if (parts.length < 10) continue
    const year = Number(parts[0])
    const month = Number(parts[1])
    const anomaly = Number(parts[parts.length - 1])
    if (year > 1900 && month >= 1 && month <= 12 && Number.isFinite(anomaly)) {
      return { year, month, anomaly }
    }
  }
  return null
}

export function normalizeEnso(html: string, indexText: string, fetchedAt: string): {
  signal: NormalizedSignal
  metric: NormalizedGlobalMetric
} {
  const status = parseEnsoStatus(html)
  const index = parseNino34(indexText)
  const valid = index ? new Date(Date.UTC(index.year, index.month - 1, 1)).toISOString() : fetchedAt
  const anomaly = index?.anomaly ?? null
  const signal: NormalizedSignal = {
    department: 'hydro_weather',
    source: 'enso',
    signal_type: 'enso_status',
    title: status,
    lat: null,
    lon: null,
    country_iso3: null,
    value_num: anomaly,
    value_raw: { status, nino34_anomaly: anomaly, year: index?.year ?? null, month: index?.month ?? null },
    unit_raw: 'celsius_anomaly',
    event_time: valid,
    url: ENSO_DISCUSSION,
    dedupe_key: buildDedupeKey({
      source: 'enso',
      signalType: 'enso_status',
      id: `${status}|${index?.year ?? ''}|${index?.month ?? ''}`,
      eventTime: valid,
    }),
  }
  return {
    signal,
    metric: {
      metric: 'nino34_anomaly',
      valid_time: valid,
      issued_at: fetchedAt,
      value: anomaly,
      unit: 'celsius_anomaly',
      source: 'enso',
      detail: { status },
    },
  }
}

export const ensoSource: CrisisSource = {
  key: 'enso',
  department: 'hydro_weather',
  scheduleMinutes: 7 * 24 * 60,
  writes: 'signals',
  async fetch(ctx): Promise<IngestFetchResult> {
    const discussion = await politeFetch(ENSO_DISCUSSION, { sourceKey: 'enso', as: 'text', minIntervalMs: 1000 })
    const index = await politeFetch(ENSO_INDEX, { sourceKey: 'enso', as: 'text', minIntervalMs: 1000 })
    if (!discussion.ok || !index.ok) {
      return {
        httpCalls: 2,
        error: `enso HTTP discussion=${discussion.status} index=${index.status}`,
      }
    }
    const row = normalizeEnso(discussion.text, index.text, ctx.now.toISOString())
    return { signals: [row.signal], globalMetrics: [row.metric], httpCalls: 2 }
  },
}
