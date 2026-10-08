import { buildDedupeKey } from '../dedupe'
import { isoTime, politeFetch } from '../fetch'
import { extractXmlTag, parseAtomEntries, parseGeorssPoint } from '../xml'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

export const NTWC_ATOM = 'https://www.tsunami.gov/events/xml/PAAQAtom.xml'
export const PTWC_ATOM = 'https://www.tsunami.gov/events/xml/PHEBAtom.xml'

export function normalizeTsunamiAtom(xml: string, center: 'NTWC' | 'PTWC'): NormalizedSignal[] {
  const entries = parseAtomEntries(xml)
  if (!entries.length) {
    return [
      {
        department: 'geology',
        source: 'tsunami',
        signal_type: 'tsunami_all_clear',
        title: `No ${center} Atom entries`,
        lat: null,
        lon: null,
        country_iso3: null,
        value_num: 0,
        value_raw: { center, active_products: 0 },
        unit_raw: 'active_products',
        event_time: new Date().toISOString(),
        url: center === 'NTWC' ? NTWC_ATOM : PTWC_ATOM,
        dedupe_key: buildDedupeKey({
          source: 'tsunami',
          signalType: 'tsunami_all_clear',
          id: `${center}:${new Date().toISOString().slice(0, 13)}`,
        }),
      },
    ]
  }

  return entries.map((block) => {
    const { lat, lon } = parseGeorssPoint(block)
    const title = extractXmlTag(block, 'title')
    const id = extractXmlTag(block, 'id')
    const eventTime = isoTime(extractXmlTag(block, 'updated') || extractXmlTag(block, 'published'))
    return {
      department: 'geology',
      source: 'tsunami',
      signal_type: 'tsunami_bulletin',
      title: title || `${center} tsunami bulletin`,
      lat,
      lon,
      country_iso3: null,
      value_num: null,
      value_raw: { center, category: extractXmlTag(block, 'category'), id },
      unit_raw: 'bulletin',
      event_time: eventTime,
      url: id || (center === 'NTWC' ? NTWC_ATOM : PTWC_ATOM),
      dedupe_key: buildDedupeKey({ source: 'tsunami', signalType: 'tsunami_bulletin', id, lat, lon, eventTime }),
    }
  })
}

export const tsunamiSource: CrisisSource = {
  key: 'tsunami',
  department: 'geology',
  scheduleMinutes: 10,
  writes: 'signals',
  async fetch(): Promise<IngestFetchResult> {
    const headers = { Accept: 'application/atom+xml, application/xml, text/xml, */*' }
    const ntwc = await politeFetch(NTWC_ATOM, { sourceKey: 'tsunami', minIntervalMs: 4000, as: 'text', headers })
    const ptwc = await politeFetch(PTWC_ATOM, { sourceKey: 'tsunami', minIntervalMs: 4000, as: 'text', headers })
    const signals: NormalizedSignal[] = []
    if (ntwc.ok) signals.push(...normalizeTsunamiAtom(ntwc.text, 'NTWC'))
    if (ptwc.ok) signals.push(...normalizeTsunamiAtom(ptwc.text, 'PTWC'))
    if (!ntwc.ok && !ptwc.ok) {
      return { httpCalls: 2, error: ntwc.error || ptwc.error || `NTWC ${ntwc.status} PTWC ${ptwc.status}` }
    }
    return { httpCalls: 2, signals }
  },
}
