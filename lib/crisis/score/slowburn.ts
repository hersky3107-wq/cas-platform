import { lastCompleteUtcDay, dayShift } from './silence'
import { ESCALATION, SLOW_BURN } from './thresholds'

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
  return hasNewActorCounted(
    new Map(recentPartners.filter(Boolean).map((partner) => [partner, SLOW_BURN.newActorMinRecent])),
    new Set(priorPartners),
  )
}

/** A new actor had zero events with this country in the prior 60 days and at least 5 in the last 14. */
export function hasNewActorCounted(
  recentCounts: Map<string, number>,
  priorPartners: Set<string>,
  minRecent = SLOW_BURN.newActorMinRecent,
): boolean {
  for (const [partner, count] of recentCounts) {
    if (!partner || priorPartners.has(partner)) continue
    if (count >= minRecent) return true
  }
  return false
}

export function dowAdjust(days: string[], values: number[], minWeeks = 8): number[] {
  return values.map((value, index) => {
    const weekday = new Date(`${days[index]}T00:00:00Z`).getUTCDay()
    const peers = values.filter((_, other) => other !== index && new Date(`${days[other]}T00:00:00Z`).getUTCDay() === weekday)
    if (peers.length < minWeeks) return value
    const mean = peers.reduce((sum, item) => sum + item, 0) / peers.length
    if (mean <= 0) return 0
    return value / mean
  })
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
  cameo_share: number
  num_sources: number
}

const CORE: Array<{ key: keyof DailyVolume; direction: 'up' | 'down'; minSlope: number; dow: boolean }> = [
  { key: 'conflict_share', direction: 'up', minSlope: SLOW_BURN.shareSlope, dow: true },
  { key: 'avg_goldstein', direction: 'down', minSlope: 0.02, dow: true },
  { key: 'avg_tone', direction: 'down', minSlope: 0.02, dow: true },
  { key: 'cameo_share', direction: 'up', minSlope: SLOW_BURN.shareSlope, dow: true },
]

/** Four calendar weeks of conflict-share, each higher than the one before. Percent is last week versus the first. */
export function fourWeekConflictRise(rows: DailyVolume[], endDay: string): number | null {
  const window = lastWindow(rows, endDay, 28)
  if (window.length < 21) return null
  const end = Date.parse(`${endDay}T00:00:00Z`)
  const sums = [0, 0, 0, 0]
  const counts = [0, 0, 0, 0]
  for (const row of window) {
    const age = Math.floor((end - Date.parse(`${row.day}T00:00:00Z`)) / 86_400_000)
    if (age < 0 || age > 27) continue
    const week = 3 - Math.floor(age / 7)
    sums[week] += row.conflict_share
    counts[week] += 1
  }
  if (counts.some((count) => count === 0)) return null
  const means = sums.map((sum, index) => sum / counts[index])
  for (let i = 1; i < means.length; i += 1) if (!(means[i] > means[i - 1])) return null
  if (means[0] <= 0) return null
  return Math.round(((means[3] - means[0]) / means[0]) * 100)
}

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
  const cameoSum = window.reduce((acc, row) => acc + row.cameo_18_20, 0)
  const days = window.map((row) => row.day)
  const indicators: TrendReading[] = CORE.map((spec) => {
    const raw = window.map((row) => row[spec.key] as number)
    const series = spec.dow ? dowAdjust(days, raw) : raw
    const reading = assessTrend(series, spec.direction, spec.minSlope)
    reading.key = spec.key
    if (events < SLOW_BURN.minEvents || cameoSum < SLOW_BURN.minCameo) reading.significant = false
    return reading
  })
  indicators.push(...extras)
  const cameo = indicators.find((row) => row.key === 'cameo_share' || row.key === 'conflict_share')
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

export function conflictShareEscalation(
  series: Array<{ day: string; total: number; cameo: number }>,
  now: Date,
): { value: number; raw: Record<string, unknown> } {
  const endDay = lastCompleteUtcDay(now)
  const window = series.filter((row) => row.day <= endDay && row.day > dayShift(endDay, -SLOW_BURN.windowDays))
  const events = window.reduce((sum, row) => sum + row.total, 0)
  const cameo = window.reduce((sum, row) => sum + row.cameo, 0)
  const shares = window.map((row) => (row.total > 0 ? row.cameo / row.total : 0))
  const adjusted = dowAdjust(window.map((row) => row.day), shares)
  const reading = assessTrend(adjusted, 'up', SLOW_BURN.shareSlope)
  const enough = events >= SLOW_BURN.minEvents && cameo >= SLOW_BURN.minCameo && window.length >= SLOW_BURN.minPoints
  const value = enough && reading.significant && !reading.spiked
    ? reading.slope >= 0.02
      ? ESCALATION.fast
      : ESCALATION.growing
    : 0
  return {
    value,
    raw: {
      complete_day: endDay,
      events,
      cameo,
      slope: Number(reading.slope.toFixed(4)),
      significant: reading.significant,
    },
  }
}
