/**
 * tzolkin: Maya 260-day count (nawal 1-20, tone 1-13), via the standard GMT
 * (Goodman-Martinez-Thompson) correlation constant 584283 — the Julian Day
 * Number of Maya Long Count 0.0.0.0.0, "4 Ajaw 8 Kumk'u". Validated against
 * the widely-documented public correlation date 2012-12-21 = "4 Ajaw" (Long
 * Count 13.0.0.0.0) in the engine's test suite.
 *
 * Pure calendar-date function: the Tzolk'in day count advances once per
 * civil day and does not depend on time-of-day or timezone, so this takes a
 * plain date only (no time/tz parameters), unlike the ganzhi functions.
 */
import type { SolarCalendarDate, TzolkinResult } from './types'
import { TZOLKIN_NAWAL } from './tables'
import { assertYearInRange, julianDayNumber, parseYmd } from './utils'

const GMT_CORRELATION_CONSTANT = 584283

export function tzolkin(input: SolarCalendarDate): TzolkinResult {
  const { y, m, d } = parseYmd(input.date)
  assertYearInRange(y)

  const longCountDay = julianDayNumber(y, m, d) - GMT_CORRELATION_CONSTANT
  const tone = ((((longCountDay % 13) + 13) % 13) + 3) % 13 + 1
  const nawalIndex0 = (((longCountDay % 20) + 20) % 20 + 19) % 20
  const nawal = nawalIndex0 + 1

  return { nawal, nawalName: TZOLKIN_NAWAL[nawalIndex0]!.name, tone }
}
