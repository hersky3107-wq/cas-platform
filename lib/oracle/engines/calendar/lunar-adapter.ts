/**
 * Thin, isolated boundary around `lunar-javascript`. The package only ships a
 * minimal ambient .d.ts (types/lunar-javascript.d.ts, covering the resident
 * "today" widget's needs), so every other member is accessed through `any`
 * here and re-exposed with our own explicit types. No other file in this
 * engine touches the raw library — this keeps the "untyped npm package" risk
 * contained to one place.
 *
 * IMPORTANT (see docs/calendar-verification.md): the library's internal jieqi
 * table is expressed in China Standard Time (UTC+8), not the caller's
 * timezone, and the library's default/"ByLiChun" accessors compare by
 * calendar DATE only (not full datetime). This adapter always requests the
 * `*Exact` accessor family and expects callers to feed Beijing-equivalent
 * (UTC+8) civil fields when resolving year/month pillars.
 */
import * as LunarJsModule from 'lunar-javascript'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LunarJs: any = LunarJsModule

export interface RawLunarHandle {
  getYearGanExact(): string
  getYearZhiExact(): string
  getMonthGanExact(): string
  getMonthZhiExact(): string
  getDayGan(): string
  getDayZhi(): string
  getTimeGan(): string
  getTimeZhi(): string
  getYear(): number
  getMonth(): number
  getDay(): number
  getJieQiTable(): Record<string, RawJieQiHandle>
  getNextJieQi(): RawJieQiHandle
  getPrevJieQi(): RawJieQiHandle
  getEightChar(): RawEightCharHandle
  getDayNineStar(): { toString(): string }
  getSolar(): RawSolarHandle
}

export interface RawJieQiHandle {
  toString(): string
  getSolar(): RawSolarHandle
}

export interface RawSolarHandle {
  getYear(): number
  getMonth(): number
  getDay(): number
  getHour(): number
  getMinute(): number
  getSecond(): number
  getLunar(): RawLunarHandle
}

export interface RawDaYunHandle {
  getStartYear(): number
  getEndYear(): number
  getStartAge(): number
  getEndAge(): number
  getIndex(): number
  getGanZhi(): string
}

export interface RawYunHandle {
  isForward(): boolean
  getStartYear(): number
  getDaYun(): RawDaYunHandle[]
}

export interface RawEightCharHandle {
  getYun(genderCode: 1 | 0): RawYunHandle
}

export function solarFromYmdHms(y: number, m: number, d: number, h: number, mi: number, s: number): RawSolarHandle {
  return LunarJs.Solar.fromYmdHms(y, m, d, h, mi, s) as RawSolarHandle
}

export function solarFromYmd(y: number, m: number, d: number): RawSolarHandle {
  return LunarJs.Solar.fromYmd(y, m, d) as RawSolarHandle
}

export function lunarFromYmd(y: number, m: number, d: number): RawLunarHandle {
  return LunarJs.Lunar.fromYmd(y, m, d) as RawLunarHandle
}

/** 1 = male, 0 = female (verified against library behavior; see docs/calendar-verification.md). */
export type RawGenderCode = 1 | 0
