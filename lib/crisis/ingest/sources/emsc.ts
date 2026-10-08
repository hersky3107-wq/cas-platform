import { buildDedupeKey } from '../dedupe'
import { asArray, asRecord, finiteNumber, isoTime, politeFetch } from '../fetch'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

export function emscUrl(now: Date, hours = 2): string {
  const end = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const start = new Date(now.getTime() - hours * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  return `https://www.seismicportal.eu/fdsnws/event/1/query?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&format=json`
}

export function normalizeEmsc(geojson: unknown): NormalizedSignal[] {
  const root = asRecord(geojson)
  const features = asArray(root?.features)
  const out: NormalizedSignal[] = []
  for (const item of features) {
    const feat = asRecord(item)
    if (!feat) continue
    const props = asRecord(feat.properties) ?? {}
    const geom = asRecord(feat.geometry)
    const coords = asArray(geom?.coordinates)
    const lon = finiteNumber(coords[0]) ?? finiteNumber(props.lon)
    const lat = finiteNumber(coords[1]) ?? finiteNumber(props.lat)
    const depth = finiteNumber(props.depth) ?? finiteNumber(coords[2])
    const mag = finiteNumber(props.mag) ?? finiteNumber(props.magnitude)
    const id = typeof feat.id === 'string' ? feat.id : typeof props.unid === 'string' ? props.unid : null
    const eventTime = isoTime(props.time)
    out.push({
      department: 'geology',
      source: 'emsc',
      signal_type: 'earthquake',
      title:
        typeof props.flynn_region === 'string'
          ? `M${mag ?? '?'} ${props.flynn_region}`
          : mag != null
            ? `M${mag} earthquake`
            : 'earthquake',
      lat,
      lon,
      country_iso3: null,
      value_num: mag,
      value_raw: {
        mag,
        depth_km: depth,
        magtype: props.magtype ?? props.magType ?? null,
        flynn_region: props.flynn_region ?? null,
        source_catalog: props.source_catalog ?? null,
        unid: props.unid ?? id,
      },
      unit_raw: typeof props.magtype === 'string' ? props.magtype : typeof props.magType === 'string' ? props.magType : 'magnitude',
      event_time: eventTime,
      url: typeof props.url === 'string' ? props.url : 'https://www.seismicportal.eu/fdsn-wsevent.html',
      dedupe_key: buildDedupeKey({ source: 'emsc', signalType: 'earthquake', id, lat, lon, eventTime }),
    })
  }
  return out
}

export const emscSource: CrisisSource = {
  key: 'emsc',
  department: 'geology',
  scheduleMinutes: 10,
  writes: 'signals',
  async fetch(ctx): Promise<IngestFetchResult> {
    const res = await politeFetch(emscUrl(ctx.now), { sourceKey: 'emsc', minIntervalMs: 5000 })
    if (!res.ok) return { httpCalls: 1, error: res.error ?? `HTTP ${res.status}` }
    return { httpCalls: 1, signals: normalizeEmsc(res.data) }
  },
}
