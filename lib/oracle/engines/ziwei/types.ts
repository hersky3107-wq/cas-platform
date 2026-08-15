export type ZiweiSex = 'male' | 'female'

export type ZiweiDayBoundary = 'zi_start' | 'civil_midnight'

export type ZiweiInput = {
  /** YYYY-MM-DD */
  birthDate: string
  /** HH:mm, or null when birth time is unknown. */
  birthTime: string | null
  /** IANA timezone, e.g. Asia/Seoul. */
  tz: string
  sex: ZiweiSex
  /** Defaults to `zi_start`, matching the calendar engine. */
  dayBoundary?: ZiweiDayBoundary
}

export type WuXingJuName = '水二局' | '木三局' | '金四局' | '土五局' | '火六局'

export type StarCategory = 'major' | 'lucky' | 'malefic' | 'minor'

export type StarBrightness = '庙' | '旺' | '得' | '利' | '平' | '不' | '陷'

export type PalaceName =
  | '命'
  | '兄弟'
  | '夫妻'
  | '子女'
  | '財帛'
  | '疾厄'
  | '遷移'
  | '交友'
  | '官祿'
  | '田宅'
  | '福德'
  | '父母'

export type PlacedStar = {
  name: string
  category: StarCategory
  brightness?: StarBrightness
}

export type Palace = {
  /** 0–11, 子 through 亥 (same index as the calendar engine). */
  index: number
  branch: string
  stem: string
  name: PalaceName
  stars: PlacedStar[]
}

export type ZiweiLunar = {
  year: number
  month: number
  day: number
  isLeapMonth: boolean
  yearStem: string
  yearBranch: string
  hourBranch: string | null
}

export type GongRef = {
  index: number
  branch: string
  stem: string
}

export type WuXingJu = {
  name: WuXingJuName
  number: 2 | 3 | 4 | 5 | 6
}

export type ZiweiLimitation = 'no_birth_time'

export type ZiweiChart =
  | {
      lunar: ZiweiLunar
      mingGong: null
      shenGong: null
      wuXingJu: null
      palaces: []
      flags: { leapMonth: boolean; lateZiHour: boolean; lunarDayRolled: boolean }
      limitations: ZiweiLimitation[]
    }
  | {
      lunar: ZiweiLunar
      mingGong: GongRef
      shenGong: GongRef
      wuXingJu: WuXingJu
      palaces: Palace[]
      flags: { leapMonth: boolean; lateZiHour: boolean; lunarDayRolled: boolean }
      limitations: []
    }
