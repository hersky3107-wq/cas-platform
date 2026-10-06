/**
 * Display tables for the divination seat's 사주 / 구성기학 line.
 * Pure data — safe for the client tile. No lunar-javascript import here.
 */

export const HEAVENLY_STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const
export const STEMS_HANGUL = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'] as const
export const EARTHLY_BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const
export const BRANCHES_HANGUL = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'] as const

export type EarthlyBranch = (typeof EARTHLY_BRANCHES)[number]

export function isGanzhi(value: unknown): value is string {
  if (typeof value !== 'string' || [...value].length !== 2) return false
  const [stem, branch] = [...value]
  return (HEAVENLY_STEMS as readonly string[]).includes(stem) && (EARTHLY_BRANCHES as readonly string[]).includes(branch)
}

/** 甲辰 → 갑진. Null when the input is not a stem+branch pair. */
export function ganzhiHangul(ganzhi: string): string | null {
  if (!isGanzhi(ganzhi)) return null
  const [stem, branch] = [...ganzhi]
  return `${STEMS_HANGUL[HEAVENLY_STEMS.indexOf(stem as (typeof HEAVENLY_STEMS)[number])]}${
    BRANCHES_HANGUL[EARTHLY_BRANCHES.indexOf(branch as EarthlyBranch)]
  }`
}

export const DIRECTIONS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
export type Direction8 = (typeof DIRECTIONS_8)[number]
export type KigakuDirection = Direction8 | 'center'

export function isKigakuDirection(value: unknown): value is KigakuDirection {
  return value === 'center' || (DIRECTIONS_8 as readonly unknown[]).includes(value)
}

export const OPPOSITE_DIRECTION: Record<Direction8, Direction8> = {
  N: 'S',
  NE: 'SW',
  E: 'W',
  SE: 'NW',
  S: 'N',
  SW: 'NE',
  W: 'E',
  NW: 'SE',
}

/** 九星 names by star number (index 0 = 一白). Japanese forms; zh-TW has its own row. */
export const NINE_STAR_HANJA = ['一白水星', '二黒土星', '三碧木星', '四緑木星', '五黄土星', '六白金星', '七赤金星', '八白土星', '九紫火星'] as const
export const NINE_STAR_HANJA_TW = ['一白水星', '二黑土星', '三碧木星', '四綠木星', '五黃土星', '六白金星', '七赤金星', '八白土星', '九紫火星'] as const
export const NINE_STAR_HANGUL = ['일백수성', '이흑토성', '삼벽목성', '사록목성', '오황토성', '육백금성', '칠적금성', '팔백토성', '구자화성'] as const

export function isNineStar(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9
}

export const DIRECTION_KO: Record<KigakuDirection, string> = {
  N: '북방',
  NE: '동북방',
  E: '동방',
  SE: '동남방',
  S: '남방',
  SW: '서남방',
  W: '서방',
  NW: '서북방',
  center: '중앙',
}
