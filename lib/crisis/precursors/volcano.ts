import { haversineKm } from '../score/math'
import { cellKey } from './earthquake'

export const VOLCANO_SEISMIC_KM = 20
export const VOLCANO_THERMAL_KM = 15
export const VOLCANO_REGION_KM = 100
export const VOLCANO_SEISMIC_MIN = 5
export const VOLCANO_SEISMIC_HOURS = 72

export type PrecursorKind = 'seismic' | 'thermal' | 'alert' | 'ash' | 'so2' | 'weekly'

export interface PrecursorBit {
  kind: PrecursorKind
  multiplier?: number
  steps?: number
  name?: string
}

export interface HoloceneVolcano {
  id: string
  name: string
  lat: number
  lon: number
}

export interface LabeledPoint {
  lat: number
  lon: number
  name: string
  at: string | null
  kind: PrecursorKind
  steps?: number
}

export interface SeismicQuake {
  lat: number
  lon: number
  mag: number
  at: string | null
}

/**
 * Two or more precursor types, or an alert-level rise, fires the volcano probability forecast.
 * Seismicity counts M2.5+ inside 20 km and 72 h, at >= 5 events and >= 3x the cell background
 * scaled by the area of that circle.
 */
export function volcanoPrecursors(opts: {
  lat: number
  lon: number
  now: Date
  volcanoes: HoloceneVolcano[]
  quakes: SeismicQuake[]
  yearCounts: Map<string, number>
  points: LabeledPoint[]
}): PrecursorBit[] {
  const bits: PrecursorBit[] = []
  const since = opts.now.getTime() - VOLCANO_SEISMIC_HOURS * 3_600_000
  let bestSeismic: PrecursorBit | null = null
  for (const volcano of opts.volcanoes) {
    if (haversineKm(opts.lat, opts.lon, volcano.lat, volcano.lon) > VOLCANO_REGION_KM) continue
    let count = 0
    for (const quake of opts.quakes) {
      if (quake.mag < 2.5) continue
      const t = quake.at ? Date.parse(quake.at) : opts.now.getTime()
      if (Number.isFinite(t) && t < since) continue
      if (haversineKm(volcano.lat, volcano.lon, quake.lat, quake.lon) > VOLCANO_SEISMIC_KM) continue
      count += 1
    }
    if (count < VOLCANO_SEISMIC_MIN) continue
    const year = opts.yearCounts.get(cellKey(volcano.lat, volcano.lon)) ?? 0
    const area = (VOLCANO_SEISMIC_KM / 111) ** 2
    const expected = Math.max(0, year * area * (3 / 365))
    const baseline = Math.max(expected, 3 / 365)
    const multiplier = count / baseline
    if (multiplier < 3) continue
    if (!bestSeismic || (multiplier > (bestSeismic.multiplier ?? 0))) {
      bestSeismic = { kind: 'seismic', multiplier, name: volcano.name }
    }
  }
  if (bestSeismic) bits.push(bestSeismic)

  const seen = new Set<PrecursorKind>()
  for (const point of opts.points) {
    if (point.kind === 'seismic') continue
    if (haversineKm(opts.lat, opts.lon, point.lat, point.lon) > VOLCANO_REGION_KM) continue
    if (seen.has(point.kind)) {
      if (point.kind === 'alert' && point.steps != null) {
        const current = bits.find((bit) => bit.kind === 'alert')
        if (current && (point.steps ?? 0) > (current.steps ?? 0)) current.steps = point.steps
      }
      continue
    }
    seen.add(point.kind)
    bits.push({
      kind: point.kind,
      steps: point.steps,
      name: point.name,
    })
  }
  return bits
}

export function volcanoPrecursorFires(bits: PrecursorBit[]): boolean {
  const kinds = new Set(bits.map((bit) => bit.kind))
  if (kinds.size >= 2) return true
  return bits.some((bit) => bit.kind === 'alert' && (bit.steps ?? 0) >= 1)
}
