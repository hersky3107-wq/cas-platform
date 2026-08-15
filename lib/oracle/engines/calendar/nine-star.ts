/**
 * 구성 (Nine Star Ki / 구성기학) — 본명성(year)/월명성(month)/일명성(day).
 *
 * Year and month stars use the documented digit-reduction formulas, anchored
 * to 입춘 / 12-jie boundaries from `solarTerms()`.
 *
 * Day star is the 気学 日盤 (K.Oka / Calend Mate / nobml), not 玄空飛星.
 * See conventions.ts and docs/nine-star-verification.md.
 */
import type { DateTimeInput, NineStarResult, NineStarValue } from './types'
import { NINE_STARS } from './tables'
import { solarTerms } from './ganzhi'
import { CalendarInputError } from './errors'
import { addCivilYmd, assertYearInRange, CALENDAR_MAX_YEAR, CALENDAR_MIN_YEAR, civilFieldsInZone, julianDayNumber, parseYmd, resolveInstantUtc } from './utils'

const WANG_ZHI = new Set([0, 6, 3, 9]) // 자오묘유
const GO_ZHI = new Set([4, 10, 1, 7]) // 진술축미
const TOKYO = 'Asia/Tokyo'

interface DaySwitch {
  jdn: number
  yang: boolean
  startStar: number
}

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

/** MJD at 00:00 UT of the civil date. JDN is noon-based, so MJD = JDN − 2400001. */
function mjdAtUtMidnight(y: number, m: number, d: number): number {
  return julianDayNumber(y, m, d) - 2400001
}

/** 干支 index K, 甲子=0 … 癸亥=59. nobml: K = (MJD + 50) mod 60. */
function ganzhiK(y: number, m: number, d: number): number {
  return (((mjdAtUtMidnight(y, m, d) + 50) % 60) + 60) % 60
}

function nearestKoshi(y: number, m: number, d: number): { y: number; m: number; d: number } {
  const k = ganzhiK(y, m, d)
  // nobml / K.Oka: 0–28 → previous 甲子; 29–59 → next 甲子.
  return k <= 28 ? addCivilYmd(y, m, d, -k) : addCivilYmd(y, m, d, 60 - k)
}

function solsticeTokyoDate(year: number, hangul: '동지' | '하지'): { y: number; m: number; d: number } {
  const term = solarTerms(year).find((t) => t.hangul === hangul)
  if (!term) throw new CalendarInputError(`could not locate ${hangul} in ${year}`)
  const f = civilFieldsInZone(new Date(term.utcIso), TOKYO)
  return { y: f.y, m: f.m, d: f.d }
}

function rawSwitchesAround(year: number): DaySwitch[] {
  const from = Math.max(CALENDAR_MIN_YEAR, year - 2)
  const to = Math.min(CALENDAR_MAX_YEAR, year + 2)
  const out: DaySwitch[] = []
  for (let y = from; y <= to; y++) {
    const summer = solsticeTokyoDate(y, '하지')
    const winter = solsticeTokyoDate(y, '동지')
    const sKoshi = nearestKoshi(summer.y, summer.m, summer.d)
    const wKoshi = nearestKoshi(winter.y, winter.m, winter.d)
    out.push({ jdn: julianDayNumber(sKoshi.y, sKoshi.m, sKoshi.d), yang: false, startStar: 9 })
    out.push({ jdn: julianDayNumber(wKoshi.y, wKoshi.m, wKoshi.d), yang: true, startStar: 1 })
  }
  out.sort((a, b) => a.jdn - b.jdn)
  const deduped: DaySwitch[] = []
  for (const s of out) {
    if (deduped.at(-1)?.jdn !== s.jdn) deduped.push(s)
  }
  return deduped
}

/** Apply 九星閏 to raw 甲子 switches (nobml 240-day rule). */
function applyKyuseiJun(raw: DaySwitch[]): DaySwitch[] {
  const result = raw.map((s) => ({ ...s }))
  for (let i = 0; i < raw.length - 1; i++) {
    const gap = raw[i + 1]!.jdn - raw[i]!.jdn
    if (gap === 180) continue
    if (gap === 240) {
      const later = raw[i + 1]!
      result[i + 1] = {
        jdn: later.jdn - 30,
        yang: later.yang,
        startStar: later.yang ? 7 : 3,
      }
      continue
    }
    if (gap === 120) {
      throw new CalendarInputError('九星閏 120-day compression is not implemented (attested only far outside 1900–2100)')
    }
    throw new CalendarInputError(`unexpected 日盤 switch gap of ${gap} days`)
  }
  return result
}

const SWITCHES_BY_YEAR = new Map<number, DaySwitch[]>()

function switchesForYear(year: number): DaySwitch[] {
  const cached = SWITCHES_BY_YEAR.get(year)
  if (cached) return cached
  const applied = applyKyuseiJun(rawSwitchesAround(year))
  SWITCHES_BY_YEAR.set(year, applied)
  return applied
}

function dayStarNumber(y: number, m: number, d: number): number {
  const target = julianDayNumber(y, m, d)
  const switches = switchesForYear(y)
  let current = switches[0]
  if (!current) throw new CalendarInputError('日盤 switch table is empty')
  for (const s of switches) {
    if (s.jdn <= target) current = s
    else break
  }
  const days = target - current.jdn
  return current.yang ? normalizeStar(current.startStar + days) : normalizeStar(current.startStar - days)
}

export function nineStar(input: DateTimeInput): NineStarResult {
  const { date, time, timezone } = input
  const { y, m, d } = parseYmd(date)
  assertYearInRange(y)
  const utcInstant = resolveInstantUtc(date, time, timezone)

  const qiYear = lichunAdjustedYear(utcInstant, y)
  const yearBranchIndex = ((qiYear - 4) % 12 + 12) % 12
  const yearNum = yearStarNumber(qiYear)

  const terms = solarTerms(y).concat(solarTerms(y - 1)).concat(solarTerms(y + 1))
  const jieTerms = terms.filter((t) => t.isJie).sort((a, b) => a.utcIso.localeCompare(b.utcIso))
  let currentJie = jieTerms[0]!
  for (const t of jieTerms) {
    if (new Date(t.utcIso).getTime() <= utcInstant.getTime()) currentJie = t
  }
  const monthBranchIndex = currentJie.branchIndexIfJie!
  const monthNum = monthStarNumber(yearBranchIndex, jieMonthNumber(monthBranchIndex))
  const dayNum = dayStarNumber(y, m, d)

  return {
    year: starValue(yearNum),
    month: starValue(monthNum),
    day: starValue(dayNum),
  }
}
