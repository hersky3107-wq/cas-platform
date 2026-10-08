import { buildDedupeKey } from '../dedupe'
import { asArray, asRecord, finiteNumber, isoTime, politeFetch } from '../fetch'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

export const EONET_OPEN = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30'
export const EONET_CAP = 500

/** FIRMS owns fires. Keep the remaining EONET natural-hazard categories. */
export const EONET_KEEP = new Set([
  'severeStorms',
  'volcanoes',
  'floods',
  'landslides',
  'seaLakeIce',
  'dustHaze',
  'drought',
  'snow',
  'earthquakes',
  'tempExtremes',
])

export function eonetCategoryId(ev: Record<string, unknown>): string | null {
  const cats = asArray(ev.categories)
  const cat = asRecord(cats[0] ?? null)
  return typeof cat?.id === 'string' ? cat.id : null
}

export function normalizeEonet(payload: unknown, cap = EONET_CAP): { signals: NormalizedSignal[]; capped: boolean; beforeCap: number } {
  const root = asRecord(payload)
  const events = asArray(root?.events)
  const out: NormalizedSignal[] = []
  for (const item of events) {
    const ev = asRecord(item)
    if (!ev) continue
    const signalType = eonetCategoryId(ev) ?? 'natural_event'
    if (!EONET_KEEP.has(signalType)) continue
    const geometries = asArray(ev.geometry)
    const geom = asRecord(geometries[geometries.length - 1] ?? null)
    const coords = asArray(geom?.coordinates)
    const lon = finiteNumber(coords[0])
    const lat = finiteNumber(coords[1])
    const id = typeof ev.id === 'string' ? ev.id : null
    const eventTime = isoTime(geom?.date)
    const sources = asArray(ev.sources)
    const firstSrc = asRecord(sources[0] ?? null)
    out.push({
      department: 'geology',
      source: 'eonet',
      signal_type: signalType,
      title: typeof ev.title === 'string' ? ev.title : signalType,
      lat,
      lon,
      country_iso3: null,
      value_num: finiteNumber(geom?.magnitudeValue),
      value_raw: {
        category: signalType,
        magnitudeValue: geom?.magnitudeValue ?? null,
        magnitudeUnit: geom?.magnitudeUnit ?? null,
        closed: ev.closed ?? null,
      },
      unit_raw: typeof geom?.magnitudeUnit === 'string' ? geom.magnitudeUnit : null,
      event_time: eventTime,
      url: typeof ev.link === 'string' ? ev.link : typeof firstSrc?.url === 'string' ? firstSrc.url : EONET_OPEN,
      dedupe_key: buildDedupeKey({ source: 'eonet', signalType, id, lat, lon, eventTime }),
    })
  }
  const beforeCap = out.length
  const signals = out.slice(0, cap)
  return { signals, capped: beforeCap > cap, beforeCap }
}

export const eonetSource: CrisisSource = {
  key: 'eonet',
  department: 'geology',
  scheduleMinutes: 60,
  writes: 'signals',
  async fetch(ctx): Promise<IngestFetchResult> {
    const res = await politeFetch(EONET_OPEN, { sourceKey: 'eonet', minIntervalMs: 10_000 })
    if (!res.ok) return { httpCalls: 1, error: res.error ?? `HTTP ${res.status}` }
    const { signals, capped, beforeCap } = normalizeEonet(res.data)
    if (capped) ctx.log(`[eonet] capped at ${EONET_CAP} (filtered events=${beforeCap})`)
    ctx.log(`[eonet] rows=${signals.length} filtered=${beforeCap} capped=${capped}`)
    return {
      httpCalls: 1,
      signals,
      quotaNote: capped ? `capped at ${EONET_CAP} of ${beforeCap} filtered events` : `rows=${signals.length}`,
    }
  },
}
