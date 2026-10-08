import { buildDedupeKey } from '../dedupe'
import { asArray, asRecord, finiteNumber, isoTime, politeFetch } from '../fetch'
import { extractXmlAttr, extractXmlTag, parseXmlItems } from '../xml'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

const GDACS_JSON = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF'
const GDACS_RSS = 'https://www.gdacs.org/xml/rss.xml'

function fromJsonEvent(item: unknown): NormalizedSignal | null {
  const row = asRecord(item)
  if (!row) return null
  const lat = finiteNumber(row.latitude) ?? finiteNumber(row.lat)
  const lon = finiteNumber(row.longitude) ?? finiteNumber(row.lon)
  const eventType = String(row.eventtype ?? row.eventType ?? 'disaster')
  const alert = String(row.alertlevel ?? row.alertLevel ?? '')
  const severity = finiteNumber(row.severity) ?? finiteNumber(row.episodealertscore)
  const id = String(row.eventid ?? row.eventId ?? row.id ?? '')
  const eventTime = isoTime(row.fromdate ?? row.date ?? row.toDate)
  return {
    department: 'hydro_weather',
    source: 'gdacs',
    signal_type: eventType,
    title: typeof row.name === 'string' ? row.name : typeof row.htmlDescription === 'string' ? row.htmlDescription : `${alert} ${eventType}`.trim(),
    lat,
    lon,
    country_iso3: typeof row.iso3 === 'string' ? row.iso3 : null,
    value_num: severity,
    value_raw: { alert_level: alert || null, severity, event_type: eventType, eventid: id },
    unit_raw: 'alert_level',
    event_time: eventTime,
    url: typeof row.url === 'string' ? row.url : 'https://www.gdacs.org/',
    dedupe_key: buildDedupeKey({ source: 'gdacs', signalType: eventType, id: id || null, lat, lon, eventTime }),
  }
}

export function normalizeGdacsJson(payload: unknown): NormalizedSignal[] {
  const root = asRecord(payload)
  const features = asArray(root?.features ?? root?.events ?? payload)
  const out: NormalizedSignal[] = []
  for (const item of features) {
    const rec = asRecord(item)
    const props = rec?.properties ? rec.properties : item
    const signal = fromJsonEvent(props)
    if (signal) out.push(signal)
  }
  return out
}

export function normalizeGdacsRss(xml: string): NormalizedSignal[] {
  return parseXmlItems(xml).map((item) => {
    const title = extractXmlTag(item, 'title')
    const lat = finiteNumber(extractXmlTag(item, 'geo:lat'))
    const lon = finiteNumber(extractXmlTag(item, 'geo:long'))
    const iso3 = extractXmlTag(item, 'gdacs:iso3')
    const alert = extractXmlTag(item, 'gdacs:alertlevel')
    const eventType = extractXmlTag(item, 'gdacs:eventtype') || 'disaster_alert'
    const eventId = extractXmlTag(item, 'gdacs:eventid')
    const severity = finiteNumber(extractXmlAttr(item, 'gdacs:severity', 'value'))
    const eventTime = isoTime(extractXmlTag(item, 'pubDate'))
    const link = extractXmlTag(item, 'link')
    return {
      department: 'hydro_weather',
      source: 'gdacs',
      signal_type: eventType,
      title: title || `${alert ?? ''} ${eventType}`.trim(),
      lat,
      lon,
      country_iso3: iso3,
      value_num: severity,
      value_raw: { alert_level: alert, severity, event_type: eventType, eventid: eventId },
      unit_raw: extractXmlAttr(item, 'gdacs:severity', 'unit') || 'alert_level',
      event_time: eventTime,
      url: link || GDACS_RSS,
      dedupe_key: buildDedupeKey({ source: 'gdacs', signalType: eventType, id: eventId, lat, lon, eventTime }),
    }
  })
}

export const gdacsSource: CrisisSource = {
  key: 'gdacs',
  department: 'hydro_weather',
  scheduleMinutes: 30,
  writes: 'signals',
  async fetch(): Promise<IngestFetchResult> {
    const json = await politeFetch(GDACS_JSON, { sourceKey: 'gdacs', minIntervalMs: 8000 })
    if (json.ok) {
      const signals = normalizeGdacsJson(json.data)
      if (signals.length) return { httpCalls: 1, signals }
    }
    const rss = await politeFetch(GDACS_RSS, { sourceKey: 'gdacs', minIntervalMs: 8000, as: 'text' })
    if (!rss.ok) return { httpCalls: 2, error: rss.error ?? json.error ?? `HTTP ${rss.status}` }
    return { httpCalls: json.ok ? 2 : 2, signals: normalizeGdacsRss(rss.text) }
  },
}
