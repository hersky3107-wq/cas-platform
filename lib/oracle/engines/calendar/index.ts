/**
 * Pure calendar engine — 만세력/사주 four-pillars, solar terms, five-element
 * balance, ten gods, great-luck (대운), nine-star (구성), sukuyou (27수),
 * season element, and Maya tzolkin.
 *
 * PURE FUNCTIONS ONLY: no DB, no network, no LLM calls, no Date.now(). Every
 * function that resolves an instant takes an explicit date/time + IANA
 * timezone. This module is additive — it does not modify any existing
 * oracle file. See docs/calendar-verification.md for the Step-1 verification
 * against public 만세력 references and two critical library-behavior
 * findings (timezone frame + date-vs-datetime precision) that this engine
 * corrects for.
 *
 * Bump CALENDAR_ENGINE_VERSION whenever any function's output changes.
 */
export const CALENDAR_ENGINE_VERSION = '1.0.0'

export { toLunar, toSolar, solarTerms, fourPillars } from './ganzhi'
export { fiveElementBalance } from './five-elements'
export { tenGods } from './ten-gods'
export { greatLuck } from './great-luck'
export { nineStar } from './nine-star'
export { sukuyou } from './sukuyou'
export { seasonElement } from './season-element'
export { weekday } from './weekday'
export { tzolkin } from './tzolkin'

export { CalendarInputError, CalendarRangeError } from './errors'
export { CALENDAR_MIN_YEAR, CALENDAR_MAX_YEAR } from './utils'

export type {
  FiveElement,
  YinYang,
  StemInfo,
  BranchInfo,
  Pillar,
  FourPillars,
  LunarCalendarDate,
  SolarCalendarDate,
  SolarTermInstant,
  FiveElementCounts,
  TenGodName,
  TenGodsResult,
  GreatLuckPeriod,
  GreatLuckResult,
  NineStarValue,
  NineStarResult,
  SukuyouResult,
  SeasonElement,
  TzolkinResult,
  DateTimeInput,
} from './types'
export type { WeekdayIndex } from './weekday'
