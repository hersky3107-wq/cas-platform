import { buildDedupeKey } from '../dedupe'
import { asArray, asRecord, finiteNumber, isoTime, politeFetch } from '../fetch'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

const YEAR = new Date().getUTCFullYear()
export const GVP_WFS =
  `https://webservices.volcano.si.edu/geoserver/GVP-VOTW/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Eruptions&maxFeatures=80&outputFormat=application/json&CQL_FILTER=StartDateYear>=${YEAR - 2}`
export const USGS_HANS = 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes'

export function normalizeGvpWfs(payload: unknown): NormalizedSignal[] {
  const root = asRecord(payload)
  const features = asArray(root?.features)
  const out: NormalizedSignal[] = []
  for (const item of features) {
    const feat = asRecord(item)
    if (!feat) continue
    const props = asRecord(feat.properties) ?? {}
    const coords = asArray(asRecord(feat.geometry)?.coordinates)
    const lon = finiteNumber(coords[0])
    const lat = finiteNumber(coords[1])
    const name = String(props.Volcano_Name ?? props.VolcanoName ?? props.volcano_name ?? 'volcano')
    const year = finiteNumber(props.StartDateYear)
    const id = String(feat.id ?? props.VolcanoNumber ?? name)
    const eventTime = year != null ? new Date(Date.UTC(year, 0, 1)).toISOString() : isoTime(props.StartDate)
    out.push({
      department: 'geology',
      source: 'volcano',
      signal_type: 'holocene_eruption',
      title: name,
      lat,
      lon,
      country_iso3: null,
      value_num: finiteNumber(props.ExplosivityIndexMax ?? props.VEI_max),
      value_raw: {
        volcano: name,
        country: props.Country ?? props.country ?? null,
        vei: props.ExplosivityIndexMax ?? props.VEI_max ?? null,
        start_year: year,
      },
      unit_raw: 'vei',
      event_time: eventTime,
      url: 'https://volcano.si.edu/database/webservices.cfm',
      dedupe_key: buildDedupeKey({ source: 'volcano', signalType: 'holocene_eruption', id, lat, lon, eventTime }),
    })
  }
  return out
}

export function normalizeHans(payload: unknown): NormalizedSignal[] {
  const rows = asArray(payload)
  const out: NormalizedSignal[] = []
  for (const item of rows) {
    const v = asRecord(item)
    if (!v) continue
    const name = String(v.volcano_name ?? v.volcName ?? 'elevated volcano')
    const lat = finiteNumber(v.latitude)
    const lon = finiteNumber(v.longitude)
    const eventTime = isoTime(v.sent ?? v.notice_sent)
    const id = String(v.volcano_id ?? v.volcId ?? name)
    out.push({
      department: 'geology',
      source: 'volcano',
      signal_type: 'elevated_volcano',
      title: `${name} ${v.alert_level ?? ''} ${v.color_code ?? ''}`.trim(),
      lat,
      lon,
      country_iso3: 'USA',
      value_num: null,
      value_raw: {
        volcano: name,
        alert_level: v.alert_level ?? null,
        color_code: v.color_code ?? null,
        obs: v.obs_abbr ?? v.obs_fullname ?? null,
      },
      unit_raw: 'aviation_color_code',
      event_time: eventTime,
      url: 'https://volcanoes.usgs.gov/hans-public/api/volcano/default',
      dedupe_key: buildDedupeKey({ source: 'volcano', signalType: 'elevated_volcano', id, lat, lon, eventTime }),
    })
  }
  return out
}

export const volcanoSource: CrisisSource = {
  key: 'volcano',
  department: 'geology',
  scheduleMinutes: 360,
  writes: 'signals',
  async fetch(): Promise<IngestFetchResult> {
    const wfs = await politeFetch(GVP_WFS, { sourceKey: 'volcano', minIntervalMs: 10_000 })
    const hans = await politeFetch(USGS_HANS, { sourceKey: 'volcano', minIntervalMs: 10_000 })
    const signals: NormalizedSignal[] = []
    if (wfs.ok) signals.push(...normalizeGvpWfs(wfs.data))
    if (hans.ok) signals.push(...normalizeHans(hans.data))
    if (!wfs.ok && !hans.ok) {
      return { httpCalls: 2, error: wfs.error || hans.error || `WFS ${wfs.status} HANS ${hans.status}` }
    }
    return { httpCalls: 2, signals, error: wfs.ok ? undefined : wfs.error ?? undefined }
  },
}
