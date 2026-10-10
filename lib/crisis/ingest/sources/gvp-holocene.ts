import { buildDedupeKey } from '../dedupe'
import { asArray, asRecord, finiteNumber, politeFetch } from '../fetch'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

export const GVP_HOLOCENE =
  'https://webservices.volcano.si.edu/geoserver/GVP-VOTW/wfs?service=WFS&version=1.0.0&request=GetFeature' +
  '&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&maxFeatures=2000&outputFormat=application/json'

export function normalizeHolocene(payload: unknown): NormalizedSignal[] {
  const features = asArray(asRecord(payload)?.features)
  const out: NormalizedSignal[] = []
  const eventTime = '2020-01-01T00:00:00.000Z'
  for (const item of features) {
    const feat = asRecord(item)
    if (!feat) continue
    const props = asRecord(feat.properties) ?? {}
    const coords = asArray(asRecord(feat.geometry)?.coordinates)
    const lon = finiteNumber(coords[0]) ?? finiteNumber(props.Longitude)
    const lat = finiteNumber(coords[1]) ?? finiteNumber(props.Latitude)
    if (lat == null || lon == null) continue
    const name = String(props.Volcano_Name ?? props.VolcanoName ?? 'volcano')
    const id = String(props.Volcano_Number ?? feat.id ?? name)
    out.push({
      department: 'geology',
      source: 'gvp_holocene',
      signal_type: 'holocene_volcano',
      title: name,
      lat,
      lon,
      country_iso3: null,
      value_num: finiteNumber(props.Last_Eruption_Year),
      value_raw: {
        volcano: name,
        volcano_number: id,
        country: props.Country ?? null,
        last_eruption_year: props.Last_Eruption_Year ?? null,
      },
      unit_raw: 'year',
      event_time: eventTime,
      url: 'https://volcano.si.edu/',
      dedupe_key: buildDedupeKey({
        source: 'gvp_holocene',
        signalType: 'holocene_volcano',
        id,
        lat,
        lon,
        eventTime,
      }),
    })
  }
  return out
}

export const gvpHoloceneSource: CrisisSource = {
  key: 'gvp_holocene',
  department: 'geology',
  scheduleMinutes: 1440,
  writes: 'signals',
  async fetch(ctx): Promise<IngestFetchResult> {
    const { count, error } = await ctx.client
      .from('crisis_raw_signals')
      .select('id', { count: 'exact', head: true })
      .eq('signal_type', 'holocene_volcano')
    if (error) return { httpCalls: 0, error: error.message }
    if ((count ?? 0) >= 800) {
      return { httpCalls: 0, signals: [], quotaNote: `holocene catalog present (${count})` }
    }
    const res = await politeFetch(GVP_HOLOCENE, { sourceKey: 'gvp_holocene', minIntervalMs: 5000, timeoutMs: 90_000 })
    if (!res.ok) return { httpCalls: 1, error: res.error ?? `HTTP ${res.status}`, skipped: undefined }
    const signals = normalizeHolocene(res.data)
    if (!signals.length) return { httpCalls: 1, error: 'GVP Holocene WFS returned no volcanoes' }
    return { httpCalls: 1, signals, quotaNote: `volcanoes=${signals.length}` }
  },
}
