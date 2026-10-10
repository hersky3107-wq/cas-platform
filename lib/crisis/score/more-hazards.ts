import { haversineKm } from './math'
import type { TriggerComponent } from './types'

export type OutageCause = 'government_directed' | 'unknown' | 'power_outage' | 'cable_cut' | 'weather' | 'exam'

export const ADVISORY_REASONS = [
  'terrorism',
  'armed_conflict',
  'kidnapping',
  'unrest',
  'crime',
  'health',
  'natural_disaster',
  'wrongful_detention',
] as const

export type AdvisoryReason = (typeof ADVISORY_REASONS)[number]

const REASON_PATTERNS: Array<{ reason: AdvisoryReason; pattern: RegExp }> = [
  { reason: 'terrorism', pattern: /terroris/i },
  { reason: 'armed_conflict', pattern: /armed conflict|\bmilitary conflict\b|\bactive conflict\b/i },
  { reason: 'kidnapping', pattern: /kidnap|hostage|abduct/i },
  { reason: 'unrest', pattern: /civil unrest|\bunrest\b/i },
  { reason: 'crime', pattern: /\bcrime\b|criminal/i },
  { reason: 'health', pattern: /\bhealth\b|disease outbreak|epidemic/i },
  { reason: 'natural_disaster', pattern: /natural disaster|earthquake|hurricane|typhoon/i },
  { reason: 'wrongful_detention', pattern: /wrongful detention|arbitrary detention/i },
]

const SERIOUS = new Set<AdvisoryReason>(['terrorism', 'unrest', 'armed_conflict'])

export function parseAdvisoryReasons(text: string | null | undefined): AdvisoryReason[] {
  const blob = text ?? ''
  return ADVISORY_REASONS.filter((reason) => {
    if (blob.includes(reason)) return true
    return REASON_PATTERNS.find((row) => row.reason === reason)?.pattern.test(blob) ?? false
  })
}

/** Advisories that do not cite conflict, unrest, or terrorism count at half weight. */
export function advisoryReasonWeight(reasons: AdvisoryReason[]): number {
  return reasons.some((reason) => SERIOUS.has(reason)) ? 1 : 0.5
}

export function classifyOutage(hints: string[], iso3: string | null): { cause: OutageCause; weight: number } {
  const text = hints.join(' ')
  const government = /government|state[-_ ]?ordered|ordered shutdown|directed|censorship|shutdown order/i.test(text)
  const power = /power[_ -]?outage|\bpower cut\b/i.test(text)
  const cable = /cable[_ -]?cut|submarine cable|fiber cut/i.test(text)
  const weather = /\bweather\b|storm damage|hurricane/i.test(text)
  const exam = /exam|baccalaureat|시험/i.test(text)
  if (power && !government) return { cause: 'power_outage', weight: 0 }
  if (cable && !government) return { cause: 'cable_cut', weight: 0 }
  if (weather && !government) return { cause: 'weather', weight: 0 }
  if (government) return { cause: 'government_directed', weight: 1 }
  if (exam || iso3 === 'IRQ') return { cause: 'exam', weight: 0.2 }
  return { cause: 'unknown', weight: 0.5 }
}

export function forecastGeomagneticG(text: string): number {
  const cut = text.search(/greatest expected/i)
  const body = cut >= 0 ? text.slice(cut) : text
  let max = 0
  for (const match of body.matchAll(/G(\d)/g)) max = Math.max(max, Number(match[1]))
  return max
}

export function diseaseFromTitle(title: string): string {
  const parts = title.split(/\s+-\s+/)
  if (parts.length < 2) return title.trim()
  return parts.slice(0, -1).join(' - ').trim()
}

export interface UcdpPoint {
  lat: number | null
  lon: number | null
  regionId: number | null
  iso3: string | null
  at: string | null
}

export function ucdpConfirms(
  region: { id: number; lat: number; lon: number; iso3: string | null },
  events: UcdpPoint[],
  km = 150,
): boolean {
  return events.some((event) => {
    if (event.regionId != null && event.regionId === region.id) return true
    if (event.lat != null && event.lon != null && haversineKm(region.lat, region.lon, event.lat, event.lon) <= km) return true
    return false
  })
}

export function terrorComponent(opts: {
  level: number
  threatToday: number
  threatMean: number | null
  threatDays: number
  advisoryTerror: boolean
}): TriggerComponent {
  const growth =
    opts.level === 1 &&
    opts.threatDays >= 3 &&
    opts.threatToday >= 3 &&
    (opts.threatMean == null || opts.threatMean <= 0 || opts.threatToday >= opts.threatMean * 2)
  const advisory = opts.level === 1 && opts.advisoryTerror
  let value = 0
  if (growth && advisory) value = 0.8
  else if (growth) value = 0.65
  else if (advisory) value = 0.55
  return {
    key: 'terror',
    department: 'conflict',
    value,
    raw: {
      threat_today: opts.threatToday,
      threat_mean: opts.threatMean,
      advisory_terrorism: advisory,
    },
  }
}

export function waterborneComponent(opts: {
  rain: number
  river: number
  camp: boolean
  vulnerability: number | null
}): TriggerComponent {
  const flood = opts.rain > 0 || opts.river > 0
  const wash = opts.camp || (opts.vulnerability != null && opts.vulnerability >= 6)
  return {
    key: 'waterborne',
    department: 'health',
    value: flood && wash ? 0.55 : 0,
    raw: { camp: opts.camp, wash },
  }
}

export function outbreakComponent(diseases: string[]): TriggerComponent {
  return {
    key: 'outbreak',
    department: 'health',
    value: diseases.length ? 0.65 : 0,
    raw: { disease: diseases[0] ?? null },
  }
}

export function spaceWeatherComponent(g: number | null, lat: number, urbanPop: number): TriggerComponent {
  const high = Math.abs(lat) >= 55 && urbanPop > 0 && g != null && g >= 3
  const value = !high || g == null ? 0 : g >= 5 ? 1 : g >= 4 ? 0.85 : 0.7
  return { key: 'space_weather', department: 'natural', value, raw: { g } }
}

export function landslideComponent(near: boolean, urbanPop: number): TriggerComponent {
  return {
    key: 'landslide',
    department: 'natural',
    value: near && urbanPop >= 10_000 ? 0.7 : 0,
    raw: { populated: urbanPop >= 10_000 },
  }
}

export function locustComponent(level: string | null): TriggerComponent {
  const key = (level ?? '').toLowerCase()
  const value = key === 'danger' ? 0.8 : key === 'threat' ? 0.6 : key === 'caution' ? 0.4 : 0
  return { key: 'locust', department: 'natural', value, raw: { level: level ?? null } }
}
