/**
 * 구성 (Nine Star Ki / 구성기학) — 본명성(year)/월명성(month)/일명성(day), 절기 기준.
 *
 * Year and month stars are implemented from scratch using the documented
 * digit-reduction formulas (gender-independent, per multiple corroborating
 * Korean sources — see the engine coverage report), anchored to the real
 * 입춘/12-jie boundaries computed by `solarTerms()` rather than fixed
 * calendar dates.
 *
 * Day star (유파 gap, flagged explicitly): there is no simple digit-formula
 * equivalent documented for 일명성 comparable to the year/month ones — the
 * traditional day-star method uses a 60-day 상원/중원/하원 (三元) cycle keyed
 * to the nearest 冬至, a materially different and more intricate computation.
 * This engine falls back to lunar-javascript's `getDayNineStar()`, which
 * implements the related-but-distinct 玄空飛星 (Xuan Kong Flying Star)
 * Feng-Shui numbering. Both systems share the same 9-number Luo Shu
 * vocabulary and often agree, but they are not guaranteed to be the same
 * convention. Reconciling day-star under one explicit school is an open
 * decision — do not treat this value as equivalent-confidence to year/month.
 */
import type { DateTimeInput, FiveElement, NineStarResult, NineStarValue } from './types'
import { NINE_STARS } from './tables'
import { solarFromYmdHms } from './lunar-adapter'
import { solarTerms } from './ganzhi'
import { assertYearInRange, parseTimeOrNull, parseYmd, resolveInstantUtc } from './utils'

const WANG_ZHI = new Set([0, 6, 3, 9]) // 자오묘유
const GO_ZHI = new Set([4, 10, 1, 7]) // 진술축미

function digitSum(n: number): number {
  let s = Math.abs(n)
  while (s >= 10) {
    s = String(s)
      .split('')
      .reduce((a, c) => a + Number(c), 0)
  }
  return s
}

function normalizeStar(raw: number): number {
  let n = raw
  while (n <= 0) n += 9
  while (n > 9) n -= 9
  return n
}

function starValue(number: number): NineStarValue {
  const found = NINE_STARS.find((s) => s.number === number)!
  return { number: found.number, element: found.element, hangul: found.hangul }
}

/** GregorianYear -> LiChun-adjusted "구성 year" (Jan/early-Feb births before LiChun count as the previous year). */
function lichunAdjustedYear(utcInstant: Date, gregorianYear: number): number {
  const terms = solarTerms(gregorianYear)
  const lichun = terms.find((t) => t.branchIndexIfJie === 2) // 입춘 -> 寅
  if (!lichun) throw new Error('calendar engine: could not locate 입춘 in solarTerms output')
  return utcInstant.getTime() >= new Date(lichun.utcIso).getTime() ? gregorianYear : gregorianYear - 1
}

function yearStarNumber(qiYear: number): number {
  const ds = digitSum(qiYear)
  const base = qiYear < 2000 ? 11 : 10
  return normalizeStar(base - ds)
}

function jieMonthNumber(branchIndex: number): number {
  // 인월(寅, index2) = 1, ... 축월(丑, index1) = 12.
  return ((branchIndex - 2 + 12) % 12) + 1
}

function monthStarNumber(yearBranchIndex: number, monthNumber: number): number {
  const base = WANG_ZHI.has(yearBranchIndex) ? 9 : GO_ZHI.has(yearBranchIndex) ? 6 : 3
  return normalizeStar(base - monthNumber)
}

const CHINESE_NUMERALS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

function elementFromChineseNumeral(n: number): FiveElement {
  return NINE_STARS.find((s) => s.number === n)!.element
}

export function nineStar(input: DateTimeInput): NineStarResult {
  const { date, time, timezone } = input
  const { y, m, d } = parseYmd(date)
  assertYearInRange(y)
  const utcInstant = resolveInstantUtc(date, time, timezone)

  const qiYear = lichunAdjustedYear(utcInstant, y)
  const yearBranchIndex = ((qiYear - 4) % 12 + 12) % 12
  const yearNum = yearStarNumber(qiYear)

  // Month branch: derive from the jie period containing the birth instant, via the
  // same Beijing-equivalent + Exact resolution ganzhi.ts uses (kept local & minimal
  // here to avoid a circular import on fourPillars).
  const terms = solarTerms(y).concat(solarTerms(y - 1)).concat(solarTerms(y + 1))
  const jieTerms = terms.filter((t) => t.isJie).sort((a, b) => a.utcIso.localeCompare(b.utcIso))
  let currentJie = jieTerms[0]!
  for (const t of jieTerms) {
    if (new Date(t.utcIso).getTime() <= utcInstant.getTime()) currentJie = t
  }
  const monthBranchIndex = currentJie.branchIndexIfJie!
  const monthNum = monthStarNumber(yearBranchIndex, jieMonthNumber(monthBranchIndex))

  const localTime = parseTimeOrNull(time)
  const hh = localTime ? localTime.h : 12
  const mm = localTime ? localTime.mi : 0
  const dayNineStarStr: string = solarFromYmdHms(y, m, d, hh, mm, 0).getLunar().getDayNineStar().toString()
  const firstChar = Array.from(dayNineStarStr)[0] ?? '一'
  const dayNum = CHINESE_NUMERALS[firstChar] ?? 1

  return {
    year: starValue(yearNum),
    month: starValue(monthNum),
    day: { number: dayNum, element: elementFromChineseNumeral(dayNum), hangul: NINE_STARS.find((s) => s.number === dayNum)!.hangul },
  }
}