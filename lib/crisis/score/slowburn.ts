import { SLOW_BURN } from './thresholds'

export interface TrendReading {
  key: string
  slope: number
  worsening: boolean
  significant: boolean
  spiked: boolean
}

export type SlowBurnKind = 'quiet_rise' | 'dyad' | 'escalation'

export interface SlowBurnScore {
  value: number
  kind: SlowBurnKind | null
  indicators: TrendReading[]
  spread: boolean
  newActor: boolean
}

/** Median of pairwise slopes. x is the point index, so the unit is change per step. */
export function theilSenSlope(values: number[]): number {
  const slopes: number[] = []
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      slopes.push((values[j] - values[i]) / (j - i))
    }
  }
  if (!slopes.length) return 0
  slopes.sort((a, b) => a - b)
  const mid = Math.floor(slopes.length / 2)
  return slopes.length % 2 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2
}

export function slopeAgreeFraction(values: number[], direction: 'up' | 'down'): number {
  let pairs = 0
  let agree = 0
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      const delta = values[j] - values[i]
      pairs += 1
      if (direction === 'up' ? delta > 0 : delta < 0) agree += 1
    }
  }
  return pairs ? agree / pairs : 0
}

/** One day far above the median of the others. That is a spike, not a slow rise. */
export function hasSingleDaySpike(values: number[], ratio = SLOW_BURN.spikeRatio): boolean {
  if (values.length < 4) return false
  let maxAt = 0
  for (let i = 1; i < values.length; i += 1) if (values[i] > values[maxAt]) maxAt = i
  const others = values.filter((_, index) => index !== maxAt).sort((a, b) => a - b)
  const median = others[Math.floor(others.length / 2)] ?? 0
  const max = values[maxAt]
  if (median <= 0) return max >= ratio
  return max > median * ratio
}

export function assessTrend(values: number[], direction: 'up' | 'down', minSlope: number): TrendReading {
  const slope = theilSenSlope(values)
  const worsening = direction === 'up' ? slope > 0 : slope < 0
  const enough = values.length >= SLOW_BURN.minPoints
  const agree = slopeAgreeFraction(values, direction)
  const significant = enough && worsening && Math.abs(slope) >= minSlope && agree >= SLOW_BURN.agreeFraction
  return { key: '', slope, worsening, significant, spiked: hasSingleDaySpike(values) }
}

export function isQuietRise(indicators: TrendReading[]): boolean {
  if (indicators.some((row) => row.spiked)) return false
  return indicators.filter((row) => row.significant && row.worsening).length >= SLOW_BURN.minIndicators
}

export function conflictSpread(
  recentRegionIds: number[],
  priorRegionIds: number[],
  neighbors: Map<number, number[]>,
): boolean {
  const prior = new Set(priorRegionIds)
  for (const id of recentRegionIds) {
    if (prior.has(id)) continue
    const near = neighbors.get(id) ?? []
    if (near.some((neighbor) => prior.has(neighbor))) return true
  }
  return false
}

export function hasNewActor(recentPartners: string[], priorPartners: string[]): boolean {
  const prior = new Set(priorPartners)
  return recentPartners.some((partner) => partner && !prior.has(partner))
}

export function slowBurnValue(opts: { quiet: boolean; dyad: boolean; escalation: boolean }): number {
  if (opts.escalation) return SLOW_BURN.escalationSpread
  if (opts.quiet && opts.dyad) return SLOW_BURN.dyadFocus
  if (opts.quiet) return SLOW_BURN.quietRise
  return 0
}

export interface DailyVolume {
  day: string
  events: number
  conflict_share: number
  avg_goldstein: number
  avg_tone: number
  cameo_18_20: number
  num_sources: number
}

const CORE: Array<{ key: keyof DailyVolume; direction: 'up' | 'down'; minSlope: number }> = [
  { key: 'conflict_share', direction: 'up', minSlope: 0.002 },
  { key: 'avg_goldstein', direction: 'down', minSlope: 0.02 },
  { key: 'avg_tone', direction: 'down', minSlope: 0.02 },
  { key: 'cameo_18_20', direction: 'up', minSlope: 0.05 },
  { key: 'num_sources', direction: 'up', minSlope: 0.05 },
]

export function lastWindow(rows: DailyVolume[], endDay: string, days: number): DailyVolume[] {
  const end = Date.parse(`${endDay}T00:00:00Z`)
  const start = end - (days - 1) * 86_400_000
  return rows
    .filter((row) => {
      const t = Date.parse(`${row.day}T00:00:00Z`)
      return Number.isFinite(t) && t >= start && t <= end
    })
    .sort((a, b) => a.day.localeCompare(b.day))
}

export function scoreVolume(
  rows: DailyVolume[],
  endDay: string,
  extras: TrendReading[] = [],
): { quiet: boolean; cameoRising: boolean; indicators: TrendReading[] } {
  const window = lastWindow(rows, endDay, SLOW_BURN.windowDays)
  const events = window.reduce((acc, row) => acc + row.events, 0)
  const indicators: TrendReading[] = CORE.map((spec) => {
    const reading = assessTrend(window.map((row) => row[spec.key] as number), spec.direction, spec.minSlope)
    reading.key = spec.key
    if (events < SLOW_BURN.minEvents) reading.significant = false
    return reading
  })
  indicators.push(...extras)
  const cameo = indicators.find((row) => row.key === 'cameo_18_20')
  return {
    quiet: isQuietRise(indicators),
    cameoRising: Boolean(cameo?.significant && cameo.worsening),
    indicators,
  }
}

/** Admin1 regions that hold the country's recent conflict, not every admin1. */
export function concentratedRegions(cameoByRegion: Map<number, number>): number[] {
  const rows = [...cameoByRegion.entries()].filter(([, value]) => value > 0)
  if (!rows.length) return []
  const sorted = rows.map(([, value]) => value).sort((a, b) => a - b)
  const cut = sorted[Math.floor(sorted.length * 0.75)] ?? sorted[sorted.length - 1]
  return rows.filter(([, value]) => value >= cut).map(([id]) => id)
}
