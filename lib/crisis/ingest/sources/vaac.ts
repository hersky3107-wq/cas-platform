import { buildDedupeKey } from '../dedupe'
import { politeFetch } from '../fetch'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

export const VAAC_MESSAGES = 'https://www.ospo.noaa.gov/products/atmosphere/vaac/messages.html'
const VAAC_ORIGIN = 'https://www.ospo.noaa.gov'

export interface VaacAsh {
  name: string
  lat: number
  lon: number
  issued: string | null
  id: string
}

export function vaacXmlLinks(html: string): string[] {
  const found = new Set<string>()
  for (const match of html.matchAll(/\/products\/atmosphere\/vaac\/volcanoes\/xml_files\/[^"'?\s]+\.xml/g)) {
    found.add(`${VAAC_ORIGIN}${match[0]}`)
  }
  return [...found]
}

export function parseVaacXml(xml: string, id: string): VaacAsh | null {
  const volcano = /EruptingVolcano[\s\S]*?<name>([^<]+)<\/name>/i.exec(xml)?.[1]?.trim()
  const pos = /<gml:pos>\s*([-\d.]+)\s+([-\d.]+)\s*<\/gml:pos>/i.exec(xml)
  if (!volcano || !pos) return null
  const lat = Number(pos[1])
  const lon = Number(pos[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const issued = /<gml:timePosition>([^<]+)<\/gml:timePosition>/i.exec(xml)?.[1]?.trim() ?? null
  return { name: volcano, lat, lon, issued, id }
}

export const vaacSource: CrisisSource = {
  key: 'vaac',
  department: 'geology',
  scheduleMinutes: 180,
  writes: 'signals',
  async fetch(): Promise<IngestFetchResult> {
    const page = await politeFetch(VAAC_MESSAGES, { sourceKey: 'vaac', minIntervalMs: 3000, timeoutMs: 40_000, as: 'text' })
    if (!page.ok) return { httpCalls: 1, error: page.error ?? `HTTP ${page.status}` }
    const links = vaacXmlLinks(page.text).slice(0, 12)
    const signals: NormalizedSignal[] = []
    let httpCalls = 1
    for (const url of links) {
      httpCalls += 1
      const xml = await politeFetch(url, { sourceKey: 'vaac', minIntervalMs: 800, timeoutMs: 30_000, as: 'text' })
      if (!xml.ok) continue
      const id = url.split('/').pop() ?? url
      const ash = parseVaacXml(xml.text, id)
      if (!ash) continue
      const eventTime = ash.issued && !Number.isNaN(Date.parse(ash.issued)) ? new Date(ash.issued).toISOString() : new Date().toISOString()
      signals.push({
        department: 'geology',
        source: 'vaac',
        signal_type: 'volcano_ash',
        title: ash.name,
        lat: ash.lat,
        lon: ash.lon,
        country_iso3: null,
        value_num: 1,
        value_raw: { volcano: ash.name, advisory: id, forecast: 'probability' },
        unit_raw: 'advisory',
        event_time: eventTime,
        url,
        dedupe_key: buildDedupeKey({
          source: 'vaac',
          signalType: 'volcano_ash',
          id,
          lat: ash.lat,
          lon: ash.lon,
          eventTime,
        }),
      })
    }
    return { httpCalls, signals, quotaNote: `links=${links.length} advisories=${signals.length}` }
  },
}
