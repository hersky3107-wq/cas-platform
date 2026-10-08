import { buildDedupeKey } from '../dedupe'
import { asArray, asRecord, finiteNumber, isoTime, politeFetch } from '../fetch'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

export const EONET_OPEN = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open'

export function normalizeEonet(payload: unknown): NormalizedSignal[] {
  const root = asRecord(payload)
  const events = asArray(root?.events)
  const out: NormalizedSignal[] = []
  for (const item of events) {
    const ev = asRecord(item)
    if (!ev) continue
    const geometries = asArray(ev.geometry)
    const geom = asRecord(geometries[geometries.length - 1] ?? null)
    const coords = asArray(geom?.coordinates)
    const lon = finiteNumber(coords[0])
    const lat = finiteNumber(coords[1])
    const cats = asArray(ev.categories)
    const cat = asRecord(cats[0] ?? null)
    const signalType = typeof cat?.id === 'string' ? cat.id : 'natural_event'
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
        category: cat?.id ?? null,
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
  return out
}

export const eonetSource: CrisisSource = {
  key: 'eonet',
  department: 'geology',
  scheduleMinutes: 60,
  writes: 'signals',
  async fetch(): Promise<IngestFetchResult> {
    const res = await politeFetch(EONET_OPEN, { sourceKey: 'eonet', minIntervalMs: 10_000 })
    if (!res.ok) return { httpCalls: 1, error: res.error ?? `HTTP ${res.status}` }
    return { httpCalls: 1, signals: normalizeEonet(res.data) }
  },
}
