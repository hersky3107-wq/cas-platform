import JSZip from 'jszip'
import { buildDedupeKey } from '../dedupe'
import { politeFetch } from '../fetch'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

export const NHC_OUTLOOK_KMZ = {
  atl: 'https://www.nhc.noaa.gov/xgtwo/gtwo_atl.kmz',
  pac: 'https://www.nhc.noaa.gov/xgtwo/gtwo_pac.kmz',
} as const

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<Data name="${name}">\\s*<value>([\\s\\S]*?)</value>`, 'i').exec(block)
  return match ? match[1].replace(/\s+/g, ' ').trim() : null
}

function percent(value: string | null): number | null {
  if (!value) return null
  const match = /(\d+(?:\.\d+)?)/.exec(value)
  return match ? Number(match[1]) : null
}

function ringStats(block: string): { lat: number; lon: number; ring: number[][] } | null {
  const match = /<coordinates>([\s\S]*?)<\/coordinates>/i.exec(block)
  if (!match) return null
  const pairs = match[1].trim().split(/\s+/)
  let latSum = 0
  let lonSum = 0
  let n = 0
  const ring: number[][] = []
  for (const pair of pairs) {
    const [lonRaw, latRaw] = pair.split(',')
    const lon = Number(lonRaw)
    const lat = Number(latRaw)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    latSum += lat
    lonSum += lon
    n += 1
    if (n === 1 || n % 40 === 0) ring.push([Number(lon.toFixed(2)), Number(lat.toFixed(2))])
  }
  if (!n) return null
  return { lat: latSum / n, lon: lonSum / n, ring }
}

export function normalizeNhcOutlookKml(kml: string, basin: 'atl' | 'pac', fetchedAt: string): NormalizedSignal[] {
  const out: NormalizedSignal[] = []
  const blocks = kml.split(/<Placemark>/i).slice(1)
  for (const block of blocks) {
    const two = percent(tag(block, '2day_percentage'))
    const seven = percent(tag(block, '7day_percentage'))
    if (two == null && seven == null) continue
    const stats = ringStats(block)
    if (!stats) continue
    const disturbance = tag(block, 'Disturbance') ?? '0'
    const discussion = tag(block, 'Discussion')
    const id = `${basin}:${disturbance}:${fetchedAt.slice(0, 13)}`
    out.push({
      department: 'hydro_weather',
      source: 'nhc_outlook',
      signal_type: 'cyclone_formation',
      title: discussion ? discussion.slice(0, 180) : `${basin} disturbance ${disturbance}`,
      lat: stats.lat,
      lon: stats.lon,
      country_iso3: null,
      value_num: seven ?? two,
      value_raw: {
        basin,
        disturbance,
        prob_48h: two,
        prob_7d: seven,
        category_48h: tag(block, '2day_category'),
        category_7d: tag(block, '7day_category'),
        polygon: stats.ring,
        storm_id: id,
      },
      unit_raw: 'percent_7d',
      event_time: fetchedAt,
      url: NHC_OUTLOOK_KMZ[basin],
      dedupe_key: buildDedupeKey({
        source: 'nhc_outlook',
        signalType: 'cyclone_formation',
        id,
        lat: stats.lat,
        lon: stats.lon,
        eventTime: fetchedAt,
      }),
    })
  }
  return out
}

async function readKmz(data: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(data)
  const name = Object.keys(zip.files).find((file) => file.toLowerCase().endsWith('.kml'))
  if (!name) return ''
  return zip.files[name].async('string')
}

export const nhcOutlookSource: CrisisSource = {
  key: 'nhc_outlook',
  department: 'hydro_weather',
  scheduleMinutes: 180,
  writes: 'signals',
  async fetch(ctx): Promise<IngestFetchResult> {
    const fetchedAt = ctx.now.toISOString()
    const signals: NormalizedSignal[] = []
    let httpCalls = 0
    for (const basin of ['atl', 'pac'] as const) {
      const res = await politeFetch(NHC_OUTLOOK_KMZ[basin], {
        sourceKey: 'nhc_outlook',
        as: 'bytes',
        minIntervalMs: 1000,
      })
      httpCalls += 1
      if (!res.ok || !(res.data instanceof ArrayBuffer)) {
        ctx.log(`[nhc_outlook] ${basin} HTTP ${res.status}`)
        continue
      }
      const kml = await readKmz(res.data)
      signals.push(...normalizeNhcOutlookKml(kml, basin, fetchedAt))
    }
    return { signals, httpCalls }
  },
}
