/**
 * 27수 (Sukuyodo / lunar mansions), computed from the Moon's real ecliptic
 * longitude — see tables.ts and the coverage report for the calibration
 * caveat (tropical longitude, 0deg = mansion 1 (昴宿), not independently
 * verified against a trusted 宿曜 reference).
 */
import * as Astronomy from 'astronomy-engine'
import type { DateTimeInput, SukuyouResult } from './types'
import { SUKUYOU_MANSIONS } from './tables'
import { assertYearInRange, parseTimeOrNull, parseYmd, resolveInstantUtc } from './utils'

const DEGREES_PER_MANSION = 360 / 27

function wrapDeg(x: number): number {
  const w = x % 360
  return w < 0 ? w + 360 : w
}

export function sukuyou(input: DateTimeInput): SukuyouResult {
  const { date, time, timezone } = input
  const { y } = parseYmd(date)
  assertYearInRange(y)

  const utcInstant = resolveInstantUtc(date, time, timezone)
  const moonLongitudeDeg = wrapDeg(Astronomy.EclipticLongitude(Astronomy.Body.Moon, utcInstant))
  const index0 = Math.floor(moonLongitudeDeg / DEGREES_PER_MANSION) % 27
  const mansion = SUKUYOU_MANSIONS[index0]!

  return {
    index: index0 + 1,
    hanja: mansion.hanja,
    hangul: mansion.hangul,
    moonLongitudeDeg,
    timeUnknown: parseTimeOrNull(time) === null,
  }
}
