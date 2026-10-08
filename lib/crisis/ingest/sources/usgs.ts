import { buildDedupeKey } from '../dedupe'
import { asArray, asRecord, finiteNumber, isoTime, politeFetch } from '../fetch'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

export const USGS_ALL_HOUR = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson'

export function normalizeUsgs(geojson: unknown): NormalizedSignal[] {
  const root = asRecord(geojson)
  const features = asArray(root?.features)
  const out: NormalizedSignal[] = []
  for (const item of features) {
    const feat = asRecord(item)
    if (!feat) continue
    const props = asRecord(feat.properties) ?? {}
    const geom = asRecord(feat.geometry)
    const coords = asArray(geom?.coordinates)
    const lon = finiteNumber(coords[0])
    const lat = finiteNumber(coords[1])
    const depth = finiteNumber(coords[2])
    const mag = finiteNumber(props.mag)
    const id = typeof feat.id === 'string' ? feat.id : typeof props.code === 'string' ? props.code : null
    const eventTime = isoTime(props.time)
    out.push({
      department: 'geology',
      source: 'usgs',
      signal_type: 'earthquake',
      title: typeof props.title === 'string' ? props.title : mag != null ? `M ${mag} earthquake` : 'earthquake',
      lat,
      lon,
      country_iso3: null,
      value_num: mag,
      value_raw: {
        mag,
        depth_km: depth,
        tsunami: props.tsunami ?? 0,
        magType: props.magType ?? null,
        place: props.place ?? null,
        ids: props.ids ?? null,
      },
      unit_raw: typeof props.magType === 'string' ? props.magType : 'magnitude',
      event_time: eventTime,
      url: typeof props.url === 'string' ? props.url : USGS_ALL_HOUR,
      dedupe_key: buildDedupeKey({ source: 'usgs', signalType: 'earthquake', id, lat, lon, eventTime }),
    })
  }
  return out
}

export const usgsSource: CrisisSource = {
  key: 'usgs',
  department: 'geology',
  scheduleMinutes: 10,
  writes: 'signals',
  async fetch(): Promise<IngestFetchResult> {
    const res = await politeFetch(USGS_ALL_HOUR, { sourceKey: 'usgs', minIntervalMs: 5000 })
    if (!res.ok) return { httpCalls: 1, error: res.error ?? `HTTP ${res.status}` }
    return { httpCalls: 1, signals: normalizeUsgs(res.data) }
  },
}
