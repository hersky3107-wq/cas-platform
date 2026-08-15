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
  /**
   * YYYY-MM-DD query date used only to fill `daXian.currentDaXian` and the
   * chart's convenience `liuNian`. Does not affect star placement. When
   * omitted, `currentDaXian` and `liuNian` are null.
   */
  atDate?: string
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

export type ZiweiLimitation =
  | 'no_birth_time'
  /** 飛星四化 (宮干四化) is a separate school and is intentionally not implemented. */
  | 'no_feixing_sihua'
  /** Some 六吉/六煞 (左輔 右弼 天魁 天鉞 地空 地劫) and 小星 have no廟旺 table; their brightness is null. */
  | 'brightness_gaps'

/** 化祿/化權/化科/化忌 — the four stars a 天干 transforms. */
export type SiHuaKind = 'lu' | 'quan' | 'ke' | 'ji'

export type SiHua = {
  /** The 天干 (hanja) that produced these transformations. */
  stem: string
  /** 化祿 star name. */
  lu: string
  /** 化權 star name. */
  quan: string
  /** 化科 star name. */
  ke: string
  /** 化忌 star name. */
  ji: string
}

export type DaXianPeriod = {
  /** 地支 index 0=子, same as `Palace.index`. */
  palaceIndex: number
  palaceName: PalaceName
  /** 虚岁, inclusive. */
  ageFrom: number
  ageTo: number
}

export type DaXian = {
  /** true = 陽男陰女 (順行, increasing 地支); false = 陰男陽女 (逆行). */
  forward: boolean
  /** 虚岁 the first 大限 begins at = the 五行局 number. */
  startAge: number
  /** 12 periods in chronological order; index 0 starts at 命宮. */
  periods: DaXianPeriod[]
  /** The 大限 covering `input.atDate` (虚岁), or null when no atDate / out of range. */
  currentDaXian: DaXianPeriod | null
}

export type XiaoXian = {
  palaceIndex: number
  palaceName: PalaceName
  /** 虚岁 at the target year. */
  nominalAge: number
}

export type LiuNian = {
  year: number
  yearStem: string
  yearBranch: string
  liuNianPalace: { index: number; branch: string; name: PalaceName }
  liuNianSiHua: SiHua
  xiaoXian: XiaoXian
}

export type ZiweiChart =
  | {
      lunar: ZiweiLunar
      sex: ZiweiSex
      mingGong: null
      shenGong: null
      wuXingJu: null
      palaces: []
      /** 生年四化 — computable from the year stem even without a birth time. */
      siHua: SiHua
      daXian: null
      liuNian: null
      flags: { leapMonth: boolean; lateZiHour: boolean; lunarDayRolled: boolean }
      limitations: ZiweiLimitation[]
    }
  | {
      lunar: ZiweiLunar
      sex: ZiweiSex
      mingGong: GongRef
      shenGong: GongRef
      wuXingJu: WuXingJu
      palaces: Palace[]
      siHua: SiHua
      daXian: DaXian
      /** Convenience 流年 for `input.atDate`'s year; null when no atDate. */
      liuNian: LiuNian | null
      flags: { leapMonth: boolean; lateZiHour: boolean; lunarDayRolled: boolean }
      limitations: ZiweiLimitation[]
    }
