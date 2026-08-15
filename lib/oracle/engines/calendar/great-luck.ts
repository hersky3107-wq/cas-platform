/**
 * 대운 (Great Luck / decade periods). Delegates the direction (순행/역행) and
 * per-period ganzhi sequence to lunar-javascript's `EightChar.getYun()`, which
 * was verified (docs/calendar-verification.md) to already use the full-datetime
 * `*Exact` jieqi comparison internally — so it only needs the Beijing-equivalent
 * frame correction, same as year/month pillar resolution in ganzhi.ts.
 *
 * `startYear`/`endYear` labels are recomputed from the TRUE LOCAL birth year
 * (never the Beijing-shifted one), since a birth within ~1h of a Gregorian
 * year boundary could otherwise get a calendar-year label shifted by the
 * Beijing-equivalent conversion. `startAge`/`endAge` are pure elapsed-time
 * values and are safe to take directly (a constant UTC offset cancels out in
 * a subtraction).
 */
import type { DateTimeInput, GreatLuckPeriod, GreatLuckResult } from './types'
import { branchByHanja, stemByHanja } from './tables'
import { solarFromYmdHms } from './lunar-adapter'
import { assertYearInRange, beijingEquivalentFields, parseYmd, resolveInstantUtc } from './utils'
import { CalendarInputError } from './errors'

export function greatLuck(input: DateTimeInput & { sex: 'male' | 'female' }): GreatLuckResult {
  const { date, time, timezone, sex } = input
  const { y } = parseYmd(date)
  assertYearInRange(y)
  if (time === null) {
    throw new CalendarInputError('greatLuck requires a known birth time (hour pillar feeds the 대운수 day-distance calculation)')
  }

  const utcInstant = resolveInstantUtc(date, time, timezone)
  const bj = beijingEquivalentFields(utcInstant)
  const eightChar = solarFromYmdHms(bj.y, bj.m, bj.d, bj.h, bj.mi, bj.s).getLunar().getEightChar()

  const genderCode = sex === 'male' ? 1 : 0
  const yun = eightChar.getYun(genderCode)
  const forward = yun.isForward()
  const rawPeriods = yun.getDaYun()

  const periods: GreatLuckPeriod[] = rawPeriods
    .filter((p) => p.getIndex() >= 1) // index 0 is the "childhood" pre-first-period entry; keep only real 대운 periods
    .map((p) => {
      const ganzhi = p.getGanZhi()
      const stem = stemByHanja(ganzhi[0]!)
      const branch = branchByHanja(ganzhi[1]!)
      const startAge = p.getStartAge()
      const endAge = p.getEndAge()
      // Korean/East-Asian "counting age" convention: age 1 = birth year itself.
      return {
        index: p.getIndex(),
        startAge,
        endAge,
        startYear: y + startAge - 1,
        endYear: y + endAge - 1,
        ganzhi,
        stem,
        branch,
      }
    })

  const startAge = periods[0]?.startAge ?? 0

  return { sex, forward, startAge, periods }
}
