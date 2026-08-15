/**
 * 자미두수 PART 1 — star placement. Pure functions. No route wiring.
 * See conventions.ts for the four traps and computation order.
 */
import { fourPillars, toLunar } from '../calendar'
import { addCivilDays } from '../calendar/utils'
import { ZIWEI_ENGINE_VERSION } from './conventions'
import { ZiweiInputError } from './errors'
import {
  BRANCH_HANJA,
  HUO_LING_START,
  KUI_YUE_BY_YEAR_STEM,
  LU_CUN_BY_YEAR_STEM,
  PALACE_NAMES,
  STAR_DEFS,
  STEM_HANJA,
  TIAN_MA_BY_YEAR_BRANCH,
  TIANFU_SERIES,
  WU_XING_JU,
  ZIWEI_SERIES,
  nayinElement,
  wrap12,
} from './tables'
import type {
  GongRef,
  Palace,
  PlacedStar,
  StarBrightness,
  WuXingJu,
  ZiweiChart,
  ZiweiInput,
  ZiweiLunar,
} from './types'

export { ZIWEI_ENGINE_VERSION }
export { ZiweiInputError } from './errors'
export type { ZiweiErrorCode } from './errors'
export {
  BRANCH_HANJA,
  MAJOR_STAR_NAMES,
  PALACE_NAMES,
  TIANFU_SERIES,
  WU_XING_JU,
  ZIWEI_SERIES,
  wrap12,
} from './tables'
export type {
  GongRef,
  Palace,
  PalaceName,
  PlacedStar,
  StarBrightness,
  StarCategory,
  WuXingJu,
  WuXingJuName,
  ZiweiChart,
  ZiweiDayBoundary,
  ZiweiInput,
  ZiweiLunar,
  ZiweiSex,
} from './types'

function placeStar(name: string, branch: number): PlacedStar {
  const def = STAR_DEFS[name]
  if (!def) return { name, category: 'minor' }
  const brightness = def.brightness[branch]
  const star: PlacedStar = { name: def.name, category: def.category }
  if (brightness) star.brightness = brightness as StarBrightness
  return star
}

/** 命宮地支: 从寅起正月顺数至生月, 再从该宫起子时逆数至生时. */
export function mingGongBranch(lunarMonth: number, hourBranch: number): number {
  const monthPalace = wrap12(lunarMonth + 1) // 正月=寅(2)
  return wrap12(monthPalace - hourBranch)
}

/** 身宮地支: 从月宫起子时顺数至生时. */
export function shenGongBranch(lunarMonth: number, hourBranch: number): number {
  const monthPalace = wrap12(lunarMonth + 1)
  return wrap12(monthPalace + hourBranch)
}

/** 五虎遁: 寅宫天干 from year stem, then stems advance with 地支. */
export function wuHuDunYinStem(yearStem: number): number {
  return (yearStem % 5) * 2 + 2
}

export function palaceStem(yearStem: number, branch: number): number {
  const yinStem = wuHuDunYinStem(yearStem) % 10
  return (yinStem + wrap12(branch - 2)) % 10
}

export function wuXingJuFromMing(stemIndex: number, branchIndex: number): WuXingJu {
  return WU_XING_JU[nayinElement(stemIndex, branchIndex)]!
}

/**
 * 紫微 position (地支 index, 0=子).
 * 局数除日数至整除; 商从寅起, 加数为偶则顺加、奇则逆回.
 */
export function ziweiBranch(lunarDay: number, ju: number): number {
  let offset = 0
  while ((lunarDay + offset) % ju !== 0) offset++
  const quotient = ((lunarDay + offset) / ju) % 12
  let yinBased = quotient - 1
  if (offset % 2 === 0) yinBased += offset
  else yinBased -= offset
  return wrap12(yinBased + 2) // 寅-based 0 → 子-based 2
}

/** 天府 is the mirror of 紫微 across the 寅–申 axis. */
export function tianfuBranch(ziwei: number): number {
  return wrap12(4 - ziwei)
}

function gongRef(branch: number, yearStem: number): GongRef {
  return {
    index: branch,
    branch: BRANCH_HANJA[branch]!,
    stem: STEM_HANJA[palaceStem(yearStem, branch)]!,
  }
}

function buildPalaces(
  ming: number,
  yearStem: number,
  yearBranch: number,
  lunarMonth: number,
  lunarDay: number,
  hourBranch: number,
  ju: number,
): Palace[] {
  const ziwei = ziweiBranch(lunarDay, ju)
  const tianfu = tianfuBranch(ziwei)
  const starsAt: PlacedStar[][] = Array.from({ length: 12 }, () => [])

  const add = (name: string, branch: number) => {
    starsAt[branch]!.push(placeStar(name, branch))
  }

  for (const star of ZIWEI_SERIES) add(star.name, wrap12(ziwei - star.offset))
  for (const star of TIANFU_SERIES) add(star.name, wrap12(tianfu + star.offset))

  add('文昌', wrap12(10 - hourBranch))
  add('文曲', wrap12(4 + hourBranch))
  add('左辅', wrap12(4 + lunarMonth - 1))
  add('右弼', wrap12(10 - (lunarMonth - 1)))

  const kuiYue = KUI_YUE_BY_YEAR_STEM[yearStem]!
  add('天魁', kuiYue.kui)
  add('天钺', kuiYue.yue)

  const lu = LU_CUN_BY_YEAR_STEM[yearStem]!
  add('禄存', lu)
  add('擎羊', wrap12(lu + 1))
  add('陀罗', wrap12(lu - 1))

  const huoLing = HUO_LING_START[yearBranch]!
  add('火星', wrap12(huoLing.huo + hourBranch))
  add('铃星', wrap12(huoLing.ling + hourBranch))
  add('地空', wrap12(11 - hourBranch))
  add('地劫', wrap12(11 + hourBranch))

  add('天马', TIAN_MA_BY_YEAR_BRANCH[yearBranch]!)
  const hongluan = wrap12(3 - yearBranch)
  add('红鸾', hongluan)
  add('天喜', wrap12(hongluan + 6))

  return Array.from({ length: 12 }, (_, branch) => ({
    index: branch,
    branch: BRANCH_HANJA[branch]!,
    stem: STEM_HANJA[palaceStem(yearStem, branch)]!,
    name: PALACE_NAMES[wrap12(ming - branch)]!,
    stars: starsAt[branch]!,
  }))
}

function parseBirthTime(time: string): { h: number; mi: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) throw new ZiweiInputError('invalid_time', `expected HH:mm, got "${time}"`)
  const h = Number(match[1])
  const mi = Number(match[2])
  if (h > 23 || mi > 59) throw new ZiweiInputError('invalid_time', `out-of-range time "${time}"`)
  return { h, mi }
}

export function ziweiChart(input: ZiweiInput): ZiweiChart {
  if (input.sex !== 'male' && input.sex !== 'female') {
    throw new ZiweiInputError('invalid_sex', 'sex must be male or female')
  }

  const timeUnknown = input.birthTime === null
  const dayBoundary = input.dayBoundary ?? 'zi_start'
  let lateZiHour = false
  if (input.birthTime !== null) {
    const { h } = parseBirthTime(input.birthTime)
    lateZiHour = h >= 23
  }
  const lunarDayRolled = lateZiHour && dayBoundary === 'zi_start'
  const lunarCivilDate = lunarDayRolled ? addCivilDays(input.birthDate, 1) : input.birthDate

  let lunarDate
  try {
    lunarDate = toLunar({ date: lunarCivilDate })
  } catch (err) {
    throw new ZiweiInputError('invalid_date', err instanceof Error ? err.message : 'invalid birthDate')
  }

  const pillars = fourPillars({
    date: input.birthDate,
    time: input.birthTime,
    timezone: input.tz,
    dayBoundary,
  })

  const lunar: ZiweiLunar = {
    year: lunarDate.year,
    month: lunarDate.month,
    day: lunarDate.day,
    isLeapMonth: lunarDate.isLeapMonth,
    yearStem: pillars.year.stem.hanja,
    yearBranch: pillars.year.branch.hanja,
    hourBranch: pillars.hour?.branch.hanja ?? null,
  }

  const flags = { leapMonth: lunarDate.isLeapMonth, lateZiHour, lunarDayRolled }

  if (timeUnknown || !pillars.hour) {
    return {
      lunar,
      mingGong: null,
      shenGong: null,
      wuXingJu: null,
      palaces: [],
      flags,
      limitations: ['no_birth_time'],
    }
  }

  const hourBranch = pillars.hour.branch.index
  const yearStem = pillars.year.stem.index
  const yearBranch = pillars.year.branch.index
  const ming = mingGongBranch(lunarDate.month, hourBranch)
  const shen = shenGongBranch(lunarDate.month, hourBranch)
  const mingStem = palaceStem(yearStem, ming)
  const ju = wuXingJuFromMing(mingStem, ming)

  return {
    lunar,
    mingGong: gongRef(ming, yearStem),
    shenGong: gongRef(shen, yearStem),
    wuXingJu: ju,
    palaces: buildPalaces(ming, yearStem, yearBranch, lunarDate.month, lunarDate.day, hourBranch, ju.number),
    flags,
    limitations: [],
  }
}
