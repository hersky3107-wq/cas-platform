/**
 * Weekday of an explicit local civil date in an IANA timezone.
 * 0 = Sunday … 6 = Saturday (JS convention). Uses the calendar engine's
 * timezone resolution — not a separate solar-term clock.
 */
import type { DateTimeInput } from './types'
import { civilFieldsInZone, parseYmd, resolveInstantUtc } from './utils'

export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6

export function weekday(input: DateTimeInput): WeekdayIndex {
  parseYmd(input.date)
  const utc = resolveInstantUtc(input.date, input.time, input.timezone)
  const civil = civilFieldsInZone(utc, input.timezone)
  return new Date(Date.UTC(civil.y, civil.m - 1, civil.d)).getUTCDay() as WeekdayIndex
}
