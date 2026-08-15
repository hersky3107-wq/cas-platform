/**
 * Date/time helpers shared by the calendar engine modules. Pure functions only:
 * every conversion takes an explicit date/time/timezone, never system time.
 */
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { parse } from 'date-fns'
import { CalendarInputError, CalendarRangeError } from './errors'

export const CALENDAR_MIN_YEAR = 1900
export const CALENDAR_MAX_YEAR = 2100

export function assertYearInRange(year: number): void {
  if (!Number.isInteger(year) || year < CALENDAR_MIN_YEAR || year > CALENDAR_MAX_YEAR) {
    throw new CalendarRangeError(year)
  }
}

export function parseYmd(date: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new CalendarInputError(`invalid date string, expected YYYY-MM-DD: "${date}"`)
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

export function formatYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseHhmm(time: string): { h: number; mi: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) throw new CalendarInputError(`invalid time string, expected HH:mm: "${time}"`)
  return { h: Number(match[1]), mi: Number(match[2]) }
}

/** Resolve an explicit local date(+time) in an IANA timezone to an absolute UTC instant. */
export function resolveInstantUtc(date: string, time: string | null, timezone: string): Date {
  const hhmm = time ?? '12:00'
  const ref = parse(`${date} ${hhmm}`, 'yyyy-MM-dd HH:mm', new Date(0))
  if (Number.isNaN(ref.getTime())) throw new CalendarInputError(`invalid date/time combination: "${date} ${hhmm}"`)
  const zone = timezone && timezone.length > 1 ? timezone : 'UTC'
  return fromZonedTime(ref, zone)
}

export interface CivilFields {
  y: number
  m: number
  d: number
  h: number
  mi: number
  s: number
}

/** Civil Y-M-D-H-M-S reading in an IANA timezone for a given UTC instant. */
export function civilFieldsInZone(utc: Date, timezone: string): CivilFields {
  const zone = timezone && timezone.length > 1 ? timezone : 'UTC'
  const zoned = toZonedTime(utc, zone)
  return {
    y: zoned.getFullYear(),
    m: zoned.getMonth() + 1,
    d: zoned.getDate(),
    h: zoned.getHours(),
    mi: zoned.getMinutes(),
    s: zoned.getSeconds(),
  }
}

/**
 * Beijing (UTC+8, no DST) civil fields for the same instant — the frame
 * lunar-javascript's internal jieqi table is expressed in.
 * See docs/calendar-verification.md, "Critical finding #1".
 */
export function beijingEquivalentFields(utc: Date): CivilFields {
  const shifted = new Date(utc.getTime() + 8 * 3600 * 1000)
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
    s: shifted.getUTCSeconds(),
  }
}

/** Julian Day Number (integer, proleptic Gregorian civil date, noon-based convention). */
export function julianDayNumber(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12)
  const yy = y + 4800 - a
  const mm = m + 12 * a - 3
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045
}

export function parseTimeOrNull(time: string | null): { h: number; mi: number } | null {
  return time === null ? null : parseHhmm(time)
}
