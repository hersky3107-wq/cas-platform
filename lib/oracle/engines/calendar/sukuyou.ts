/**
 * 27수 (宿曜経): 朔日宿 of the Japanese 旧暦 month, then +1 mansion per lunar day.
 * Cycle is 27 (牛宿 omitted). See conventions.ts and docs/sukuyou-verification.md.
 */
import * as Astronomy from 'astronomy-engine'
import type { DateTimeInput, LunarCalendarDate, SukuyouRelation, SukuyouResult } from './types'
import { SUKUYOU_MANSIONS, SUKUYOU_RELATION_PAIR, SUKUYOU_SAKUJITSU_INDEX, SUKUYOU_SAN_KU } from './tables'
import { toLunar, toSolar } from './ganzhi'
import { CalendarInputError } from './errors'
import { addCivilDays, assertYearInRange, civilFieldsInZone, formatYmd, julianDayNumber, parseTimeOrNull, parseYmd } from './utils'

const JST = 'Asia/Tokyo'
const MANSION_COUNT = 27

function astroDate(found: unknown): Date {
  if (found instanceof Date) return found
  if (found && typeof found === 'object' && 'date' in found && (found as { date: Date }).date instanceof Date) {
    return (found as { date: Date }).date
  }
  throw new CalendarInputError('astronomy-engine SearchMoonPhase returned an unexpected value')
}

/** JST civil date of the true new moon nearest a Chinese 朔 solar date. */
function jstNewMoonNearChineseShuo(cnShuo: string): string {
  const { y, m, d } = parseYmd(cnShuo)
  const start = new Date(Date.UTC(y, m - 1, d - 2, 0, 0, 0))
  const found = Astronomy.SearchMoonPhase(0, start, 6)
  if (!found) throw new CalendarInputError(`could not locate the new moon near ${cnShuo}`)
  const jst = civilFieldsInZone(astroDate(found), JST)
  return formatYmd(jst.y, jst.m, jst.d)
}

function chineseMonthShuo(lunar: LunarCalendarDate): string {
  return toSolar({ year: lunar.year, month: lunar.month, day: 1, isLeapMonth: lunar.isLeapMonth }).date
}

function nextChineseMonth(lunar: LunarCalendarDate): LunarCalendarDate {
  const shuo = chineseMonthShuo(lunar)
  for (let i = 27; i <= 32; i++) {
    const probe = addCivilDays(shuo, i)
    const next = toLunar({ date: probe })
    if (next.year !== lunar.year || next.month !== lunar.month || next.isLeapMonth !== lunar.isLeapMonth) {
      return { year: next.year, month: next.month, day: 1, isLeapMonth: next.isLeapMonth }
    }
  }
  throw new CalendarInputError(`could not locate the lunar month after ${lunar.year}-${lunar.month}`)
}

/**
 * Japanese 旧暦 (JST new-moon civil date) for a civil YYYY-MM-DD.
 * `toLunar` is Chinese (CST); the two day numbers differ when the new moon
 * falls in the CST/JST midnight gap.
 */
function jdnOf(date: string): number {
  const { y, m, d } = parseYmd(date)
  return julianDayNumber(y, m, d)
}

function japaneseLunar(date: string): LunarCalendarDate {
  let cn = toLunar({ date })
  for (let attempt = 0; attempt < 3; attempt++) {
    const cnShuo = chineseMonthShuo(cn)
    const jstShuo = jstNewMoonNearChineseShuo(cnShuo)
    const next = nextChineseMonth(cn)
    const nextJstShuo = jstNewMoonNearChineseShuo(chineseMonthShuo(next))
    const day = jdnOf(date) - jdnOf(jstShuo) + 1
    const monthLen = jdnOf(nextJstShuo) - jdnOf(jstShuo)
    if (day < 1) {
      cn = toLunar({ date: addCivilDays(cnShuo, -1) })
      continue
    }
    if (day > monthLen) {
      cn = next
      continue
    }
    return { year: cn.year, month: cn.month, day, isLeapMonth: cn.isLeapMonth }
  }
  throw new CalendarInputError(`could not resolve Japanese 旧暦 for ${date}`)
}

function mansionIndex0(lunar: LunarCalendarDate): number {
  const sakujitsu = SUKUYOU_SAKUJITSU_INDEX[lunar.month - 1]
  if (sakujitsu === undefined) throw new CalendarInputError(`lunar month ${lunar.month} is out of range`)
  return (sakujitsu + lunar.day - 1) % MANSION_COUNT
}

export function sukuyou(input: DateTimeInput): SukuyouResult {
  const { date, time } = input
  const { y } = parseYmd(date)
  assertYearInRange(y)

  const lunar = japaneseLunar(date)
  const index0 = mansionIndex0(lunar)
  const mansion = SUKUYOU_MANSIONS[index0]!

  return {
    index: index0 + 1,
    hanja: mansion.hanja,
    hangul: mansion.hangul,
    lunarYear: lunar.year,
    lunarMonth: lunar.month,
    lunarDay: lunar.day,
    isLeapMonth: lunar.isLeapMonth,
    timeUnknown: parseTimeOrNull(time) === null,
  }
}

/**
 * 三九の秘法 relation from one 本命宿 to another.
 * Indices are the public 1–27 values returned by `sukuyou().index` (昴=1).
 * Direction is 逆時計 = advancing mansion index, matching senjutsu.jp
 * (業 = +9, 胎 = +18).
 */
export function sukuyouRelation(fromIndex: number, toIndex: number): SukuyouRelation {
  if (!Number.isInteger(fromIndex) || fromIndex < 1 || fromIndex > MANSION_COUNT) {
    throw new CalendarInputError(`sukuyou index must be 1–27, got ${fromIndex}`)
  }
  if (!Number.isInteger(toIndex) || toIndex < 1 || toIndex > MANSION_COUNT) {
    throw new CalendarInputError(`sukuyou index must be 1–27, got ${toIndex}`)
  }
  const offset = (toIndex - fromIndex + MANSION_COUNT) % MANSION_COUNT
  const name = SUKUYOU_SAN_KU[offset]!
  return { offset, name, pair: SUKUYOU_RELATION_PAIR[name] }
}
