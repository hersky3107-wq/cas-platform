import { buildDedupeKey } from '../dedupe'
import { asArray, asRecord, finiteNumber, isoTime, politeFetch } from '../fetch'
import { extractXmlTag, parseXmlItems } from '../xml'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

const NHC_JSON = 'https://www.nhc.noaa.gov/CurrentStorms.json'
const NHC_JSON_ALT = 'https://www.nhc.noaa.gov/maps/currentStorms/currentStorms.json'
const GIS_FEEDS = [
  'https://www.nhc.noaa.gov/gis-at.xml',
  'https://www.nhc.noaa.gov/gis-ep.xml',
  'https://www.nhc.noaa.gov/gis-cp.xml',
]
const JTWC = 'https://www.metoc.navy.mil/jtwc/jtwc.html'

function parseLatLon(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return null
  if (/[wW]$/.test(value.trim())) return -Math.abs(n)
  if (/[sS]$/.test(value.trim())) return -Math.abs(n)
  return n
}

export function normalizeNhcStorms(payload: unknown): NormalizedSignal[] {
  const root = asRecord(payload)
  const storms = asArray(root?.activeStorms ?? root?.storms ?? payload)
  const out: NormalizedSignal[] = []
  for (const item of storms) {
    const s = asRecord(item)
    if (!s) continue
    const id = String(s.id ?? s.binNumber ?? s.name ?? '')
    const lat = parseLatLon(s.latitudeNumeric ?? s.latitude_numeric ?? s.latitude)
    const lon = parseLatLon(s.longitudeNumeric ?? s.longitude_numeric ?? s.longitude)
    const intensity = finiteNumber(s.intensity)
    const eventTime = isoTime(s.lastUpdate ?? s.dateTime ?? s.lastAdvisoryDateTime)
    const advisory = asRecord(s.publicAdvisory)
    const track = asArray(s.forecastTrack ?? s.forecast ?? s.track ?? s.forecastPoints)

    if (track.length) {
      for (const point of track) {
        const p = asRecord(point) ?? {}
        const plat = parseLatLon(p.lat ?? p.latitude ?? p.latitudeNumeric)
        const plon = parseLatLon(p.lon ?? p.longitude ?? p.longitudeNumeric)
        const valid = isoTime(p.validTime ?? p.valid_time ?? p.dateTime ?? p.time) ?? eventTime
        out.push({
          department: 'hydro_weather',
          source: 'nhc_jtwc',
          signal_type: 'cyclone_forecast_point',
          title: `${s.classification ?? ''} ${s.name ?? id} forecast`.trim(),
          lat: plat,
          lon: plon,
          country_iso3: null,
          value_num: finiteNumber(p.intensity ?? p.wind ?? intensity),
          value_raw: { storm_id: id, valid_time: valid, intensity: p.intensity ?? intensity, basin: 'nhc' },
          unit_raw: 'kt',
          event_time: eventTime,
          url: typeof advisory?.url === 'string' ? advisory.url : NHC_JSON,
          dedupe_key: buildDedupeKey({
            source: 'nhc_jtwc',
            signalType: 'cyclone_forecast_point',
            id: `${id}:${valid ?? ''}`,
            lat: plat,
            lon: plon,
            eventTime: valid,
          }),
        })
      }
    } else if (lat != null && lon != null) {
      out.push({
        department: 'hydro_weather',
        source: 'nhc_jtwc',
        signal_type: 'cyclone_forecast_point',
        title: `${s.classification ?? ''} ${s.name ?? id}`.trim(),
        lat,
        lon,
        country_iso3: null,
        value_num: intensity,
        value_raw: { storm_id: id, valid_time: eventTime, intensity, basin: 'nhc' },
        unit_raw: 'kt',
        event_time: eventTime,
        url: typeof advisory?.url === 'string' ? advisory.url : NHC_JSON,
        dedupe_key: buildDedupeKey({
          source: 'nhc_jtwc',
          signalType: 'cyclone_forecast_point',
          id,
          lat,
          lon,
          eventTime,
        }),
      })
    }
  }
  return out
}

export function normalizeNhcGisTrack(geojson: unknown, stormHint = 'nhc'): NormalizedSignal[] {
  const root = asRecord(geojson)
  const features = asArray(root?.features)
  const out: NormalizedSignal[] = []
  for (const item of features) {
    const feat = asRecord(item)
    if (!feat) continue
    const props = asRecord(feat.properties) ?? {}
    const geom = asRecord(feat.geometry)
    const coords = asArray(geom?.coordinates)
    let lon: number | null = null
    let lat: number | null = null
    if (geom?.type === 'Point') {
      lon = finiteNumber(coords[0])
      lat = finiteNumber(coords[1])
    } else if (geom?.type === 'LineString' && Array.isArray(coords[0])) {
      const first = coords[0] as unknown[]
      lon = finiteNumber(first[0])
      lat = finiteNumber(first[1])
    }
    const valid = isoTime(props.ADVDATE ?? props.validTime ?? props.TAU ?? props.DATELBL)
    const id = String(props.STORMNAME ?? props.STORMNUM ?? stormHint)
    out.push({
      department: 'hydro_weather',
      source: 'nhc_jtwc',
      signal_type: 'cyclone_forecast_point',
      title: String(props.STORMNAME ?? props.STORMTYPE ?? stormHint),
      lat,
      lon,
      country_iso3: null,
      value_num: finiteNumber(props.MAXWIND ?? props.INTENSITY),
      value_raw: { storm_id: id, valid_time: valid, raw: props, basin: 'nhc_gis' },
      unit_raw: 'kt',
      event_time: valid,
      url: NHC_JSON,
      dedupe_key: buildDedupeKey({
        source: 'nhc_jtwc',
        signalType: 'cyclone_forecast_point',
        id: `${id}:${valid ?? ''}`,
        lat,
        lon,
        eventTime: valid,
      }),
    })
  }
  return out
}

function gisLinks(xml: string): string[] {
  const links: string[] = []
  for (const item of parseXmlItems(xml)) {
    const link = extractXmlTag(item, 'link') || extractXmlAttrLoose(item)
    if (!link) continue
    if (/\.(geojson|json)$/i.test(link) && /5day|pts|track|fcst/i.test(link)) links.push(link)
  }
  return links
}

function extractXmlAttrLoose(block: string): string | null {
  const match = /<link[^>]*href=["']([^"']+)["']/i.exec(block)
  return match?.[1] ?? null
}

export const nhcJtwcSource: CrisisSource = {
  key: 'nhc_jtwc',
  department: 'hydro_weather',
  scheduleMinutes: 60,
  writes: 'signals',
  async fetch(): Promise<IngestFetchResult> {
    let httpCalls = 0
    let json = await politeFetch(NHC_JSON, { sourceKey: 'nhc_jtwc', minIntervalMs: 8000 })
    httpCalls += 1
    if (!json.ok) {
      json = await politeFetch(NHC_JSON_ALT, { sourceKey: 'nhc_jtwc', minIntervalMs: 8000 })
      httpCalls += 1
    }
    const signals = json.ok ? normalizeNhcStorms(json.data) : []

    for (const feed of GIS_FEEDS) {
      const rss = await politeFetch(feed, { sourceKey: 'nhc_jtwc', minIntervalMs: 8000, as: 'text' })
      httpCalls += 1
      if (!rss.ok) continue
      for (const link of gisLinks(rss.text).slice(0, 4)) {
        const track = await politeFetch(link, { sourceKey: 'nhc_jtwc', minIntervalMs: 8000 })
        httpCalls += 1
        if (track.ok) signals.push(...normalizeNhcGisTrack(track.data, link))
      }
    }

    const jtwc = await politeFetch(JTWC, { sourceKey: 'nhc_jtwc', minIntervalMs: 8000, as: 'text' })
    httpCalls += 1
    if (jtwc.ok) {
      const text = jtwc.text.replace(/<[^>]+>/g, ' ')
      const active = /Warning\s+#\d+|Tropical (Depression|Storm|Cyclone)|Typhoon|Hurricane/i.test(text)
      const quiet = /No Current Tropical Cyclone Warnings/i.test(text)
      if (active && !quiet && !signals.length) {
        signals.push({
          department: 'hydro_weather',
          source: 'nhc_jtwc',
          signal_type: 'cyclone_forecast_point',
          title: 'JTWC indicates active tropical warning(s)',
          lat: null,
          lon: null,
          country_iso3: null,
          value_num: 1,
          value_raw: { storm_id: 'jtwc', valid_time: new Date().toISOString(), basin: 'jtwc' },
          unit_raw: 'html_warning_present',
          event_time: new Date().toISOString(),
          url: JTWC,
          dedupe_key: buildDedupeKey({
            source: 'nhc_jtwc',
            signalType: 'cyclone_forecast_point',
            id: `jtwc:${new Date().toISOString().slice(0, 13)}`,
          }),
        })
      }
    }

    if (!json.ok && !signals.length) {
      return { httpCalls, error: json.error ?? `HTTP ${json.status}` }
    }
    return { httpCalls, signals }
  },
}
