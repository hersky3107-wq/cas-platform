import { buildDedupeKey } from '../dedupe'
import { politeFetch } from '../fetch'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

export const JTWC_ADVISORIES = {
  wpac: 'https://www.metoc.navy.mil/jtwc/products/abpwweb.txt',
  io: 'https://www.metoc.navy.mil/jtwc/products/abioweb.txt',
} as const

const POTENTIAL = /potential for the development[\s\S]{0,120}?\bis\s+(low|medium|high)\b/i
const NEAR = /near\s+(\d+(?:\.\d+)?)\s*([NS])\s+(\d+(?:\.\d+)?)\s*([EW])/i

function signed(value: string, hemi: string): number {
  const n = Number(value)
  return hemi === 'S' || hemi === 'W' ? -Math.abs(n) : Math.abs(n)
}

function potentialValue(word: string): number {
  const key = word.toLowerCase()
  if (key === 'high') return 70
  if (key === 'medium') return 40
  return 20
}

export function normalizeJtwcAdvisory(text: string, basin: 'wpac' | 'io', fetchedAt: string): NormalizedSignal[] {
  const out: NormalizedSignal[] = []
  const disturbance = /TROPICAL DISTURBANCE SUMMARY:([\s\S]*?)(?:\n\s*[A-Z]\.\s+SUBTROPICAL|\n\d+\.\s+[A-Z]|\nNNNN|$)/i.exec(text)
  const body = disturbance?.[1] ?? ''
  if (/^\s*NONE\s*$/i.test(body.trim())) return out
  const chunks = body.split(/\n\s*\(\d+\)\s+/).slice(1)
  chunks.forEach((chunk, index) => {
    const where = NEAR.exec(chunk)
    const potential = POTENTIAL.exec(chunk)
    if (!where) return
    const lat = signed(where[1], where[2])
    const lon = signed(where[3], where[4])
    const word = potential?.[1] ?? 'low'
    const id = `${basin}:dist:${index + 1}:${fetchedAt.slice(0, 13)}`
    out.push({
      department: 'hydro_weather',
      source: 'jtwc_tcfa',
      signal_type: 'cyclone_formation',
      title: chunk.replace(/\s+/g, ' ').trim().slice(0, 180),
      lat,
      lon,
      country_iso3: null,
      value_num: potentialValue(word),
      value_raw: {
        basin,
        potential: word.toLowerCase(),
        prob_24h: potentialValue(word),
        storm_id: id,
      },
      unit_raw: 'formation_potential',
      event_time: fetchedAt,
      url: JTWC_ADVISORIES[basin],
      dedupe_key: buildDedupeKey({
        source: 'jtwc_tcfa',
        signalType: 'cyclone_formation',
        id,
        lat,
        lon,
        eventTime: fetchedAt,
      }),
    })
  })
  const storms = text.matchAll(/((?:TROPICAL STORM|TYPHOON|TROPICAL DEPRESSION|SUPER TYPHOON)\s+\S+\s+\(([^)]+)\))[\s\S]{0,400}?LOCATED NEAR\s+(\d+(?:\.\d+)?)([NS])\s+(\d+(?:\.\d+)?)([EW])[\s\S]{0,240}?(\d+)\s+KNOTS/gi)
  for (const storm of storms) {
    const lat = signed(storm[3], storm[4])
    const lon = signed(storm[5], storm[6])
    const name = storm[2].trim()
    const id = `${basin}:${name}`
    out.push({
      department: 'hydro_weather',
      source: 'jtwc_tcfa',
      signal_type: 'cyclone_forecast_point',
      title: storm[1].replace(/\s+/g, ' ').trim(),
      lat,
      lon,
      country_iso3: null,
      value_num: Number(storm[7]),
      value_raw: { storm_id: id, name, basin, intensity: Number(storm[7]) },
      unit_raw: 'kt',
      event_time: fetchedAt,
      url: JTWC_ADVISORIES[basin],
      dedupe_key: buildDedupeKey({
        source: 'jtwc_tcfa',
        signalType: 'cyclone_forecast_point',
        id: `${id}:${fetchedAt.slice(0, 13)}`,
        lat,
        lon,
        eventTime: fetchedAt,
      }),
    })
  }
  return out
}

export const jtwcTcfaSource: CrisisSource = {
  key: 'jtwc_tcfa',
  department: 'hydro_weather',
  scheduleMinutes: 180,
  writes: 'signals',
  async fetch(ctx): Promise<IngestFetchResult> {
    const fetchedAt = ctx.now.toISOString()
    const signals: NormalizedSignal[] = []
    let httpCalls = 0
    for (const basin of ['wpac', 'io'] as const) {
      const res = await politeFetch(JTWC_ADVISORIES[basin], { sourceKey: 'jtwc_tcfa', as: 'text', minIntervalMs: 1000 })
      httpCalls += 1
      if (!res.ok) {
        ctx.log(`[jtwc_tcfa] ${basin} HTTP ${res.status}`)
        continue
      }
      signals.push(...normalizeJtwcAdvisory(res.text, basin, fetchedAt))
    }
    return { signals, httpCalls }
  },
}
