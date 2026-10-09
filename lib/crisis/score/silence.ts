import { SILENCE } from './thresholds'

export interface GdeltDay {
  day: string
  total: number
  cameo: number
}

export function lastCompleteUtcDay(now: Date): string {
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return new Date(utc - 86_400_000).toISOString().slice(0, 10)
}

export function utcWeekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay()
}

export function dayShift(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

export function weekdayMean(series: GdeltDay[], weekday: number, exclude: Set<string>, minWeeks = SILENCE.minWeeks): number | null {
  const peers = series.filter((row) => utcWeekday(row.day) === weekday && !exclude.has(row.day))
  if (peers.length < minWeeks) return null
  return peers.reduce((sum, row) => sum + row.total, 0) / peers.length
}

export function meanLastDays(series: GdeltDay[], endDay: string, days: number): number | null {
  const window = series.filter((row) => row.day <= endDay && row.day > dayShift(endDay, -days))
  if (!window.length) return null
  return window.reduce((sum, row) => sum + row.total, 0) / window.length
}

/**
 * Silence uses the last two complete UTC days against a same-weekday mean
 * of at least 8 weeks. Today's partial day is ignored. Low-volume regions
 * (30-day mean below the floor) do not fire.
 */
export function silenceFromSeries(series: GdeltDay[], now: Date): { value: number; raw: Record<string, unknown> } {
  const complete = lastCompleteUtcDay(now)
  const previous = dayShift(complete, -1)
  const byDay = new Map(series.map((row) => [row.day, row]))
  const last = byDay.get(complete)
  const prior = byDay.get(previous)
  const mean30 = meanLastDays(series, complete, 30)
  const exclude = new Set([complete, previous])
  const lastBase = last ? weekdayMean(series, utcWeekday(complete), exclude) : null
  const priorBase = prior ? weekdayMean(series, utcWeekday(previous), exclude) : null
  const lastFrac = last && lastBase && lastBase > 0 ? last.total / lastBase : null
  const priorFrac = prior && priorBase && priorBase > 0 ? prior.total / priorBase : null
  const enoughVolume = mean30 != null && mean30 >= SILENCE.minMean30
  const twoDays =
    lastFrac != null &&
    priorFrac != null &&
    lastFrac < SILENCE.fraction &&
    priorFrac < SILENCE.fraction
  const value = enoughVolume && twoDays ? SILENCE.value : 0
  return {
    value,
    raw: {
      complete_day: complete,
      previous_day: previous,
      last_total: last?.total ?? null,
      prior_total: prior?.total ?? null,
      last_weekday_mean: lastBase,
      prior_weekday_mean: priorBase,
      last_fraction: lastFrac,
      prior_fraction: priorFrac,
      mean_30d: mean30,
      history_days: series.length,
    },
  }
}
