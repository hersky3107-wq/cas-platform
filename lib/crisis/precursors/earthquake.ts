import { clamp, haversineKm } from '../score/math'

export const RATE_MIN_EVENTS = 5
export const RATE_MIN_MULTIPLIER = 3
export const RATE_DAYS = 7
export const SWARM_KM = 50
export const SWARM_HOURS = 72
export const SWARM_MIN_EVENTS = 15
export const SWARM_MAX_MAG = 5
export const B_MIN_EVENTS = 30
export const B_DROP = 0.2

export interface QuakePoint {
  lat: number
  lon: number
  mag: number
  at: string | null
}

export interface RateFlag {
  cell: string
  lat: number
  lon: number
  count7d: number
  yearCount: number
  expected7d: number
  multiplier: number
}

/** strength = rate multiplier × hazard zone, clamped to the 0–1 trigger scale. */
export function earthquakeStrength(multiplier: number, hazardZone: number): number {
  if (!Number.isFinite(multiplier) || !Number.isFinite(hazardZone)) return 0
  return clamp(multiplier * hazardZone)
}

export function cellKey(lat: number, lon: number): string {
  const lonN = ((((lon + 180) % 360) + 360) % 360) - 180
  const latCell = Math.max(-90, Math.min(89, Math.floor(lat)))
  let lonCell = Math.floor(lonN)
  if (lonCell === 180) lonCell = -180
  return `${latCell},${lonCell}`
}

/** Collapse USGS and EMSC copies of the same hour, place, and magnitude. */
export function dedupeQuakes(points: QuakePoint[]): QuakePoint[] {
  const seen = new Set<string>()
  const out: QuakePoint[] = []
  for (const point of points) {
    const key = `${point.lat.toFixed(1)}|${point.lon.toFixed(1)}|${point.mag.toFixed(1)}|${(point.at ?? '').slice(0, 13)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(point)
  }
  return out
}

export function cellCenter(cell: string): { lat: number; lon: number } {
  const [lat, lon] = cell.split(',').map(Number)
  return { lat: lat + 0.5, lon: lon + 0.5 }
}

function inWindow(at: string | null, sinceMs: number, nowMs: number): boolean {
  if (!at) return true
  const t = Date.parse(at)
  if (!Number.isFinite(t)) return true
  return t >= sinceMs && t <= nowMs + 60_000
}

/**
 * Last 7 days of M2.5+ versus the rest of the 1-year cell count.
 * A cell flags at >= 3x and >= 5 events. An empty background still flags:
 * the expected week is at least 7/365 of one event.
 */
export function rateFlags(recent: QuakePoint[], yearCounts: Map<string, number>, now: Date): RateFlag[] {
  const nowMs = now.getTime()
  const since = nowMs - RATE_DAYS * 86_400_000
  const counts = new Map<string, number>()
  for (const quake of recent) {
    if (quake.mag < 2.5) continue
    if (!inWindow(quake.at, since, nowMs)) continue
    const key = cellKey(quake.lat, quake.lon)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const out: RateFlag[] = []
  for (const [cell, count7d] of counts) {
    if (count7d < RATE_MIN_EVENTS) continue
    const yearCount = yearCounts.get(cell) ?? 0
    const prior = Math.max(0, yearCount - count7d)
    const expected7d = Math.max(prior * (RATE_DAYS / 358), RATE_DAYS / 365)
    const multiplier = count7d / expected7d
    if (multiplier < RATE_MIN_MULTIPLIER) continue
    const center = cellCenter(cell)
    out.push({ cell, lat: center.lat, lon: center.lon, count7d, yearCount, expected7d, multiplier })
  }
  return out.sort((a, b) => b.multiplier - a.multiplier)
}

export function flagNear(lat: number, lon: number, flags: RateFlag[], km = 120): RateFlag | null {
  let best: RateFlag | null = null
  for (const flag of flags) {
    if (haversineKm(lat, lon, flag.lat, flag.lon) > km) continue
    if (!best || flag.multiplier > best.multiplier) best = flag
  }
  return best
}

export interface SwarmCluster {
  lat: number
  lon: number
  count: number
}

/** Many small events inside 72 hours and 50 km. */
export function swarmClusters(events: QuakePoint[], now: Date): SwarmCluster[] {
  const nowMs = now.getTime()
  const since = nowMs - SWARM_HOURS * 3_600_000
  const small = events.filter((event) => event.mag >= 2.5 && event.mag < SWARM_MAX_MAG && inWindow(event.at, since, nowMs))
  const used = new Set<number>()
  const out: SwarmCluster[] = []
  for (let i = 0; i < small.length; i += 1) {
    if (used.has(i)) continue
    const members: number[] = []
    for (let j = 0; j < small.length; j += 1) {
      if (haversineKm(small[i].lat, small[i].lon, small[j].lat, small[j].lon) <= SWARM_KM) members.push(j)
    }
    if (members.length < SWARM_MIN_EVENTS) continue
    let lat = 0
    let lon = 0
    for (const id of members) {
      used.add(id)
      lat += small[id].lat
      lon += small[id].lon
    }
    out.push({ lat: lat / members.length, lon: lon / members.length, count: members.length })
  }
  return out
}

export function swarmNear(lat: number, lon: number, clusters: SwarmCluster[], km = 100): SwarmCluster | null {
  let best: SwarmCluster | null = null
  for (const cluster of clusters) {
    if (haversineKm(lat, lon, cluster.lat, cluster.lon) > km) continue
    if (!best || cluster.count > best.count) best = cluster
  }
  return best
}

/** Aki maximum-likelihood b. Null when fewer than 30 events sit at or above mMin. */
export function maximumLikelihoodB(mags: number[], mMin = 2.5): number | null {
  const used = mags.filter((mag) => mag >= mMin)
  if (used.length < B_MIN_EVENTS) return null
  const mean = used.reduce((sum, mag) => sum + mag, 0) / used.length
  const denom = mean - (mMin - 0.05)
  if (denom <= 0.05) return null
  return Math.LOG10E / denom
}

export interface BDrop {
  recent: number
  reference: number
}

/**
 * Recent b at least 0.2 below the reference sample.
 * With no reference sample, compare with b = 1 and only flag a low recent b (<= 0.8).
 */
export function bValueDrop(recentMags: number[], referenceMags: number[]): BDrop | null {
  const recent = maximumLikelihoodB(recentMags)
  if (recent == null) return null
  const reference = maximumLikelihoodB(referenceMags)
  if (reference == null) {
    if (recent <= 1 - B_DROP) return { recent, reference: 1 }
    return null
  }
  if (recent <= reference - B_DROP) return { recent, reference }
  return null
}
