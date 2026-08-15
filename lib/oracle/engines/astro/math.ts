import { fromZonedTime } from 'date-fns-tz'
import type { AstroDateTime } from './types'

export const DEG = Math.PI / 180
export const RAD = 180 / Math.PI
export const DAY_MS = 86_400_000

export function normalizeDegrees(value: number): number {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

export function signedAngularDelta(to: number, from: number): number {
  const delta = normalizeDegrees(to - from)
  return delta > 180 ? delta - 360 : delta
}

export function angularSeparation(a: number, b: number): number {
  return Math.abs(signedAngularDelta(a, b))
}

export function julianDay(instant: Date): number {
  return instant.getTime() / DAY_MS + 2440587.5
}

/** IAU/Meeus mean obliquity, sufficient well beyond the engine's angle tolerance. */
export function meanObliquityDegrees(instant: Date): number {
  const t = (julianDay(instant) - 2451545) / 36525
  const arcsec = 21.448 - 46.815 * t - 0.00059 * t * t + 0.001813 * t * t * t
  return 23 + 26 / 60 + arcsec / 3600
}

export function resolveInstant(input: AstroDateTime, timeKnown = true): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new RangeError(`Invalid astrology date: ${input.date}`)
  }
  const time = timeKnown ? input.time : '12:00'
  if (time === null || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) {
    throw new RangeError('A valid HH:mm time is required when timeKnown=true')
  }
  if (!input.tz) throw new RangeError('An explicit IANA timezone is required')
  const instant = fromZonedTime(`${input.date}T${time}`, input.tz)
  if (Number.isNaN(instant.getTime())) throw new RangeError('Invalid astrology date/time/timezone')
  return instant
}
