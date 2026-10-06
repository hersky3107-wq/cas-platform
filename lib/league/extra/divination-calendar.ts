/**
 * 연주·월주 and 九星 numbers for the divination seat, via lunar-javascript.
 *
 * The library's solar-term table is China Standard Time (UTC+8), so every
 * instant is fed as UTC+8 civil fields and read through the `*Exact`
 * accessors: the year turns at the 입춘 instant, the month at each 절.
 *
 * League layer only. The oracle engine has its own calendar code; this file
 * does not import or change it.
 */
import * as LunarJsModule from 'lunar-javascript'
import type { KigakuHit } from './divination-chart-types'
import {
  EARTHLY_BRANCHES,
  HEAVENLY_STEMS,
  OPPOSITE_DIRECTION,
  isGanzhi,
  type Direction8,
  type EarthlyBranch,
  type KigakuDirection,
} from './divination-ganzhi'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LunarJs: any = LunarJsModule

const CST_OFFSET_MS = 8 * 3_600_000
const YEAR_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export type YearMonthPillars = { year: string; month: string }

function instantMs(instant: Date | string | number): number {
  if (instant instanceof Date) return instant.getTime()
  if (typeof instant === 'number') return instant
  return Date.parse(instant)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lunarAt(ms: number): any {
  const cst = new Date(ms + CST_OFFSET_MS)
  return LunarJs.Solar.fromYmdHms(
    cst.getUTCFullYear(),
    cst.getUTCMonth() + 1,
    cst.getUTCDate(),
    cst.getUTCHours(),
    cst.getUTCMinutes(),
    cst.getUTCSeconds(),
  ).getLunar()
}

export function pillarsAt(instant: Date | string | number): YearMonthPillars | null {
  const ms = instantMs(instant)
  if (!Number.isFinite(ms)) return null
  const lunar = lunarAt(ms)
  const year = String(lunar.getYearInGanZhiExact())
  const month = String(lunar.getMonthInGanZhiExact())
  return isGanzhi(year) && isGanzhi(month) ? { year, month } : null
}

export function isYearMonth(value: unknown): value is string {
  return typeof value === 'string' && YEAR_MONTH_RE.test(value)
}

/**
 * 15th 12:00 KST of the month. Every 절 falls on the 4th–8th, so mid-month
 * always sits inside the solar month that starts in that calendar month.
 */
export function midMonthInstantMs(yearMonth: string): number | null {
  const m = YEAR_MONTH_RE.exec(yearMonth)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, 15, 3, 0, 0)
}

/** Year+month only: the day of a known birth/founding date is never used. */
export function yearMonthPillars(yearMonth: string): YearMonthPillars | null {
  const ms = midMonthInstantMs(yearMonth)
  return ms == null ? null : pillarsAt(ms)
}

/** Calendar YYYY-MM of an instant in Seoul time. */
export function seoulYearMonth(instant: Date | string | number): string | null {
  const ms = instantMs(instant)
  if (!Number.isFinite(ms)) return null
  const kst = new Date(ms + 9 * 3_600_000)
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`
}

function sexagenaryIndex(ganzhi: string): number {
  const [stem, branch] = [...ganzhi]
  const s = HEAVENLY_STEMS.indexOf(stem as (typeof HEAVENLY_STEMS)[number])
  const b = EARTHLY_BRANCHES.indexOf(branch as EarthlyBranch)
  for (let n = 0; n < 60; n++) if (n % 10 === s && n % 12 === b) return n
  return -1
}

export type NineStarPeriod = {
  /** Year that owns the 年盤 (turns at 입춘, not 1 January). */
  qiYear: number
  yearStar: number
  monthStar: number
  yearBranch: EarthlyBranch
  monthBranch: EarthlyBranch
}

export function nineStarAt(instant: Date | string | number): NineStarPeriod | null {
  const ms = instantMs(instant)
  if (!Number.isFinite(ms)) return null
  const lunar = lunarAt(ms)
  const yearGz = String(lunar.getYearInGanZhiExact())
  const monthGz = String(lunar.getMonthInGanZhiExact())
  if (!isGanzhi(yearGz) || !isGanzhi(monthGz)) return null
  const civilYear = new Date(ms + CST_OFFSET_MS).getUTCFullYear()
  const qiYear = (((civilYear - 4) % 60) + 60) % 60 === sexagenaryIndex(yearGz) ? civilYear : civilYear - 1
  return {
    qiYear,
    yearStar: Number(lunar.getYearNineStar().getIndex()) + 1,
    monthStar: Number(lunar.getMonthNineStar().getIndex()) + 1,
    yearBranch: [...yearGz][1] as EarthlyBranch,
    monthBranch: [...monthGz][1] as EarthlyBranch,
  }
}

/** 後天定位盤: the star each palace holds when 五黄 is in the centre. */
const HOME_NUMBER: Record<KigakuDirection, number> = {
  N: 1,
  SW: 2,
  E: 3,
  SE: 4,
  center: 5,
  NW: 6,
  W: 7,
  NE: 8,
  S: 9,
}

/** 年盤 and 月盤 both fly forward (順行) from the centre star. */
export function starAt(center: number, direction: KigakuDirection): number {
  return ((((center - 5 + HOME_NUMBER[direction] - 1) % 9) + 9) % 9) + 1
}

export function directionOfStar(center: number, star: number): KigakuDirection {
  const found = (Object.keys(HOME_NUMBER) as KigakuDirection[]).find((d) => starAt(center, d) === star)
  return found ?? 'center'
}

const BRANCH_DIRECTION: Record<EarthlyBranch, Direction8> = {
  子: 'N',
  丑: 'NE',
  寅: 'NE',
  卯: 'E',
  辰: 'SE',
  巳: 'SE',
  午: 'S',
  未: 'SW',
  申: 'SW',
  酉: 'W',
  戌: 'NW',
  亥: 'NW',
}

export function oppositeBranch(branch: EarthlyBranch): EarthlyBranch {
  return EARTHLY_BRANCHES[(EARTHLY_BRANCHES.indexOf(branch) + 6) % 12]
}

/**
 * 五黄殺 = palace holding 五黄; 暗剣殺 = the palace opposite it; 歳破/月破 =
 * the palace of the branch opposite the year/month branch. The centre has no
 * direction, so it never carries a 殺. 五黄 in the centre clears both 五黄殺
 * and 暗剣殺 for that board.
 */
export function boardHits(
  center: number,
  branch: EarthlyBranch,
  direction: KigakuDirection,
  scope: 'year' | 'month',
): KigakuHit[] {
  if (direction === 'center') return []
  const hits: KigakuHit[] = []
  if (center !== 5) {
    const gohwang = directionOfStar(center, 5)
    if (gohwang !== 'center') {
      if (direction === gohwang) hits.push('gohwang')
      if (direction === OPPOSITE_DIRECTION[gohwang]) hits.push('amgeom')
    }
  }
  if (direction === BRANCH_DIRECTION[oppositeBranch(branch)]) hits.push(scope === 'year' ? 'sepa' : 'wolpa')
  return hits
}
