/**
 * Shared types for the pure calendar engine. Pure module: no DB, no network, no LLM,
 * no Date.now(). Every function that resolves an instant takes an explicit
 * date (+ time) and IANA timezone.
 */

export type FiveElement = 'wood' | 'fire' | 'earth' | 'metal' | 'water'
export type YinYang = 'yang' | 'yin'

export interface StemInfo {
  /** 0-9, 0 = 甲 */
  index: number
  hanja: string
  hangul: string
  element: FiveElement
  yinYang: YinYang
}

export interface BranchInfo {
  /** 0-11, 0 = 子 */
  index: number
  hanja: string
  hangul: string
  element: FiveElement
  yinYang: YinYang
  animal: string
}

export interface Pillar {
  stem: StemInfo
  branch: BranchInfo
  /** Combined hanja, e.g. "戊辰". */
  ganzhi: string
}

export type DayBoundary = 'zi_start' | 'civil_midnight'

export interface FourPillarsCore {
  year: Pillar
  month: Pillar
  day: Pillar
  /** Null when birth time is unknown. */
  hour: Pillar | null
  hourUnknown: boolean
  dayBoundaryUsed: DayBoundary
}

export interface FourPillars extends FourPillarsCore {
  /**
   * The other day-boundary convention, only when birth time is 23:00–23:59.
   * Same pillar fields as the main result (no nested alternate).
   */
  alternate: FourPillarsCore | null
}

export type FourPillarsInput = DateTimeInput & {
  /** Defaults to `zi_start`. Affects the day pillar and hour-stem only. */
  dayBoundary?: DayBoundary
}

export interface LunarCalendarDate {
  year: number
  /** 1-12. */
  month: number
  day: number
  isLeapMonth: boolean
}

export interface SolarCalendarDate {
  /** 'YYYY-MM-DD'. */
  date: string
}

export interface SolarTermInstant {
  hanja: string
  hangul: string
  /** True for the 12 "節" terms that start a ganzhi month (입춘/경칩/청명/...); false for the 12 "氣" mid-terms. */
  isJie: boolean
  /** Ganzhi month-branch index (0-11) this term starts, only set when isJie. */
  branchIndexIfJie: number | null
  /** Exact absolute instant, ISO-8601 UTC. */
  utcIso: string
}

export interface FiveElementCounts {
  wood: number
  fire: number
  earth: number
  metal: number
  water: number
}

export type TenGodName =
  | '비견'
  | '겁재'
  | '식신'
  | '상관'
  | '편재'
  | '정재'
  | '편관'
  | '정관'
  | '편인'
  | '정인'

export interface TenGodsResult {
  year: { stem: TenGodName; branch: TenGodName }
  month: { stem: TenGodName; branch: TenGodName }
  /** The day stem is the reference point ("일간"/day master), not a ten-god relationship to itself. */
  day: { stem: '일간'; branch: TenGodName }
  hour: { stem: TenGodName; branch: TenGodName } | null
}

export interface GreatLuckPeriod {
  /** 1-based period index. */
  index: number
  startAge: number
  endAge: number
  /** Calendar year, derived from the true local birth year + startAge (never CST-shift-labeled). */
  startYear: number
  endYear: number
  ganzhi: string
  stem: StemInfo
  branch: BranchInfo
}

export interface GreatLuckResult {
  sex: 'male' | 'female'
  /** 순행(true) / 역행(false). */
  forward: boolean
  /** 대운수: age (in whole years, per the underlying library) at which the first period begins. */
  startAge: number
  periods: GreatLuckPeriod[]
}

export interface NineStarValue {
  /** 1-9. */
  number: number
  element: FiveElement
  hangul: string
}

export interface NineStarResult {
  year: NineStarValue
  month: NineStarValue
  day: NineStarValue
}

export type SukuyouRelationName = '命' | '業' | '胎' | '栄' | '衰' | '安' | '危' | '成' | '壊' | '友' | '親'

export type SukuyouRelationPair = '命' | '業胎' | '栄親' | '友衰' | '安壊' | '危成'

export interface SukuyouRelation {
  /** 0–26 steps from `from` along the 昴-order cycle (逆時計 = +index). */
  offset: number
  name: SukuyouRelationName
  pair: SukuyouRelationPair
}

export interface SukuyouResult {
  /** 1-27, 宿曜経 order starting at 昴宿. */
  index: number
  hanja: string
  hangul: string
  /** Japanese 旧暦 year used for the 朔日宿 count (may differ from the civil year). */
  lunarYear: number
  /** 1-12. Leap months reuse this number's 朔日宿. */
  lunarMonth: number
  lunarDay: number
  isLeapMonth: boolean
  /** True when birth time was not supplied. 朔日宿 itself is civil-date-only. */
  timeUnknown: boolean
}

export type SeasonElement = 'WOOD' | 'FIRE' | 'EARTH' | 'METAL' | 'WATER'

export interface TzolkinResult {
  /** 1-20. */
  nawal: number
  nawalName: string
  /** 1-13. */
  tone: number
}

export interface DateTimeInput {
  /** 'YYYY-MM-DD'. */
  date: string
  /** 'HH:mm', or null when birth time is unknown. */
  time: string | null
  /** IANA timezone, e.g. 'Asia/Seoul'. */
  timezone: string
}
