import { describe, expect, it } from 'vitest'
import { fourPillars, toLunar } from '../../calendar'
import {
  MAJOR_STAR_NAMES,
  MUTAGEN_GENG_VARIANTS,
  ZIWEI_ENGINE_VERSION,
  buildDaXianPeriods,
  daXianForward,
  mingGongBranch,
  palaceStem,
  siHuaForStem,
  tianfuBranch,
  wuHuDunYinStem,
  yearStemBranch,
  ziweiBranch,
  ziweiChart,
  ziweiLiuNian,
} from '..'
import type { Palace } from '..'

describe('ziwei engine version', () => {
  it('exports ZIWEI_ENGINE_VERSION', () => {
    expect(ZIWEI_ENGINE_VERSION).toBe('1.2.0')
  })
})

describe('命宮 for a known chart', () => {
  it('places 命宮 at 午 for 2000-08-16 04:00 女 (iztro / 木三局 reference)', () => {
    const chart = ziweiChart({
      birthDate: '2000-08-16',
      birthTime: '04:00',
      tz: 'Asia/Seoul',
      sex: 'female',
    })
    expect(chart.limitations).toEqual(['no_feixing_sihua', 'brightness_gaps'])
    if (chart.mingGong === null) return
    expect(chart.mingGong.branch).toBe('午')
    expect(chart.shenGong.branch).toBe('戌')
  })
})

describe('五行局 for a known chart', () => {
  it('is 木三局 for 2000-08-16 寅时 (命宮 壬午)', () => {
    const chart = ziweiChart({
      birthDate: '2000-08-16',
      birthTime: '04:00',
      tz: 'Asia/Seoul',
      sex: 'female',
    })
    expect(chart.wuXingJu).toEqual({ name: '木三局', number: 3 })
    expect(chart.mingGong?.stem).toBe('壬')
  })

  it('is 金四局 for 1988-03-15 寅时 (命宮 甲子)', () => {
    const chart = ziweiChart({
      birthDate: '1988-03-15',
      birthTime: '04:30',
      tz: 'Asia/Seoul',
      sex: 'male',
    })
    expect(chart.wuXingJu).toEqual({ name: '金四局', number: 4 })
    expect(chart.mingGong?.branch).toBe('子')
    expect(chart.mingGong?.stem).toBe('甲')
  })
})

describe('紫微 position across 五行局', () => {
  it('matches the three canonical worked examples', () => {
    expect(ziweiBranch(27, 3)).toBe(10) // 木三局 27日 → 戌
    expect(ziweiBranch(13, 6)).toBe(11) // 火六局 13日 → 亥
    expect(ziweiBranch(6, 5)).toBe(7) // 土五局 6日 → 未
  })
})

describe('天府 is the mirror of 紫微', () => {
  it('obeys 寅↔寅, 卯↔丑, 辰↔子, 巳↔亥, 午↔戌, 未↔酉, 申↔申', () => {
    expect(tianfuBranch(2)).toBe(2)
    expect(tianfuBranch(3)).toBe(1)
    expect(tianfuBranch(4)).toBe(0)
    expect(tianfuBranch(5)).toBe(11)
    expect(tianfuBranch(6)).toBe(10)
    expect(tianfuBranch(7)).toBe(9)
    expect(tianfuBranch(8)).toBe(8)
    for (let z = 0; z < 12; z++) {
      expect(tianfuBranch(tianfuBranch(z))).toBe(z)
    }
  })
})

describe('14 主星', () => {
  it('appear exactly once across the 12 palaces', () => {
    const chart = ziweiChart({
      birthDate: '2000-08-16',
      birthTime: '04:00',
      tz: 'Asia/Seoul',
      sex: 'female',
    })
    expect(chart.palaces).toHaveLength(12)
    const majors = chart.palaces.flatMap((p) => p.stars.filter((s) => s.category === 'major').map((s) => s.name))
    expect(majors.sort()).toEqual([...MAJOR_STAR_NAMES].sort())
    expect(new Set(majors).size).toBe(14)
  })
})

describe('五虎遁 palace stems', () => {
  it('assigns a stem to every palace and follows 甲己之年丙作首', () => {
    expect(wuHuDunYinStem(0) % 10).toBe(2) // 甲 → 寅丙
    expect(wuHuDunYinStem(5) % 10).toBe(2) // 己 → 寅丙
    expect(wuHuDunYinStem(6) % 10).toBe(4) // 庚 → 寅戊
    expect(wuHuDunYinStem(4) % 10).toBe(0) // 戊 → 寅甲

    const chart = ziweiChart({
      birthDate: '2000-08-16',
      birthTime: '04:00',
      tz: 'Asia/Seoul',
      sex: 'female',
    })
    // 庚年: 寅戊 卯己 辰庚 巳辛 午壬 未癸 申甲 酉乙 戌丙 亥丁 子戊 丑己
    const expected: Record<string, string> = {
      寅: '戊',
      卯: '己',
      辰: '庚',
      巳: '辛',
      午: '壬',
      未: '癸',
      申: '甲',
      酉: '乙',
      戌: '丙',
      亥: '丁',
      子: '戊',
      丑: '己',
    }
    for (const palace of chart.palaces) {
      expect(palace.stem).toBe(expected[palace.branch])
      expect(palace.stem).toBeTruthy()
    }
    expect(palaceStem(6, 2)).toBe(4)
  })
})

describe('leap month', () => {
  it('sets the flag and uses the preceding month number (2020 闰四月)', () => {
    const lunar = toLunar({ date: '2020-06-01' })
    expect(lunar.isLeapMonth).toBe(true)
    expect(lunar.month).toBe(4)

    const chart = ziweiChart({
      birthDate: '2020-06-01',
      birthTime: '12:00',
      tz: 'Asia/Seoul',
      sex: 'male',
    })
    expect(chart.flags.leapMonth).toBe(true)
    expect(chart.lunar.month).toBe(4)
    expect(chart.lunar.isLeapMonth).toBe(true)
    if (chart.mingGong === null) return
    const hour = 6 // 午
    expect(chart.mingGong.index).toBe(mingGongBranch(4, hour))
  })
})

describe('子時 / lateZiHour', () => {
  it('marks lateZiHour at 23:30; lunar day rolls only under zi_start', () => {
    const rolled = ziweiChart({
      birthDate: '2000-08-16',
      birthTime: '23:30',
      tz: 'Asia/Seoul',
      sex: 'female',
    })
    const unrolled = ziweiChart({
      birthDate: '2000-08-16',
      birthTime: '23:30',
      tz: 'Asia/Seoul',
      sex: 'female',
      dayBoundary: 'civil_midnight',
    })
    const civilLunar = toLunar({ date: '2000-08-16' })
    const nextLunar = toLunar({ date: '2000-08-17' })
    const pillars = fourPillars({ date: '2000-08-16', time: '23:30', timezone: 'Asia/Seoul', dayBoundary: 'zi_start' })
    expect(rolled.flags.lateZiHour).toBe(true)
    expect(rolled.flags.lunarDayRolled).toBe(true)
    expect(rolled.lunar.day).toBe(nextLunar.day)
    expect(unrolled.flags.lateZiHour).toBe(true)
    expect(unrolled.flags.lunarDayRolled).toBe(false)
    expect(unrolled.lunar.day).toBe(civilLunar.day)
    expect(rolled.lunar.hourBranch).toBe(pillars.hour?.branch.hanja)
    expect(rolled.lunar.hourBranch).toBe('子')
  })
})

describe('unknown birth time', () => {
  it('returns no_birth_time without throwing or guessing a palace', () => {
    const chart = ziweiChart({
      birthDate: '2000-08-16',
      birthTime: null,
      tz: 'Asia/Seoul',
      sex: 'female',
    })
    expect(chart.limitations).toEqual(['no_birth_time', 'no_feixing_sihua', 'brightness_gaps'])
    expect(chart.mingGong).toBeNull()
    expect(chart.shenGong).toBeNull()
    expect(chart.wuXingJu).toBeNull()
    expect(chart.palaces).toEqual([])
  })
})

describe('23:30 chart — both dayBoundary conventions', () => {
  function majorsByBranch(chart: ReturnType<typeof ziweiChart>): Record<string, string[]> {
    const byBranch: Record<string, string[]> = {}
    for (const palace of chart.palaces) {
      byBranch[palace.branch] = palace.stars.filter((s) => s.category === 'major').map((s) => s.name)
    }
    return byBranch
  }

  it('zi_start rolls the lunar day (iztro 晚子时) and moves 紫微', () => {
    const chart = ziweiChart({
      birthDate: '2000-08-16',
      birthTime: '23:30',
      tz: 'Asia/Seoul',
      sex: 'female',
      dayBoundary: 'zi_start',
    })
    expect(chart.lunar.day).toBe(18)
    expect(chart.lunar.month).toBe(7)
    expect(chart.mingGong?.branch).toBe('申')
    expect(chart.shenGong?.branch).toBe('申')
    expect(chart.wuXingJu).toEqual({ name: '水二局', number: 2 })
    const by = majorsByBranch(chart)
    expect(by.戌).toContain('紫微')
    expect(by).toEqual({
      子: ['七杀'],
      丑: [],
      寅: ['廉贞'],
      卯: [],
      辰: ['破军'],
      巳: ['天同'],
      午: ['武曲', '天府'],
      未: ['太阳', '太阴'],
      申: ['贪狼'],
      酉: ['天机', '巨门'],
      戌: ['紫微', '天相'],
      亥: ['天梁'],
    })
  })

  it('civil_midnight keeps lunar day 17 and a different 紫微 seat', () => {
    const chart = ziweiChart({
      birthDate: '2000-08-16',
      birthTime: '23:30',
      tz: 'Asia/Seoul',
      sex: 'female',
      dayBoundary: 'civil_midnight',
    })
    expect(chart.lunar.day).toBe(17)
    expect(chart.mingGong?.branch).toBe('申')
    expect(chart.wuXingJu).toEqual({ name: '水二局', number: 2 })
    const by = majorsByBranch(chart)
    expect(by.酉).toContain('紫微')
    expect(by.戌).not.toContain('紫微')
    expect(by).toEqual({
      子: ['天梁'],
      丑: ['廉贞', '七杀'],
      寅: [],
      卯: [],
      辰: ['天同'],
      巳: ['武曲', '破军'],
      午: ['太阳'],
      未: ['天府'],
      申: ['天机', '太阴'],
      酉: ['紫微', '贪狼'],
      戌: ['巨门'],
      亥: ['天相'],
    })
  })
})

describe('14 主星 placement — 1988-03-15 寅时', () => {
  it('matches 星尘算命 (kvov) 金四局 reference', () => {
    const chart = ziweiChart({
      birthDate: '1988-03-15',
      birthTime: '04:30',
      tz: 'Asia/Seoul',
      sex: 'male',
    })
    const byBranch: Record<string, string[]> = {}
    for (const palace of chart.palaces) {
      byBranch[palace.branch] = palace.stars.filter((s) => s.category === 'major').map((s) => s.name)
    }
    expect(byBranch.子).toEqual(['廉贞', '天相'])
    expect(byBranch.丑).toEqual(['天梁'])
    expect(byBranch.寅).toEqual(['七杀'])
    expect(byBranch.卯).toEqual(['天同'])
    expect(byBranch.辰).toEqual(['武曲'])
    expect(byBranch.巳).toEqual(['太阳'])
    expect(byBranch.午).toEqual(['破军'])
    expect(byBranch.未).toEqual(['天机'])
    expect(byBranch.申).toEqual(['紫微', '天府'])
    expect(byBranch.酉).toEqual(['太阴'])
    expect(byBranch.戌).toEqual(['贪狼'])
    expect(byBranch.亥).toEqual(['巨门'])
  })
})

describe('04:00 / 04:30 charts must not move when dayBoundary is added', () => {
  it('2000-08-16 04:00 and 1988-03-15 04:30 are identical under both conventions', () => {
    const aZi = ziweiChart({ birthDate: '2000-08-16', birthTime: '04:00', tz: 'Asia/Seoul', sex: 'female' })
    const aCivil = ziweiChart({
      birthDate: '2000-08-16',
      birthTime: '04:00',
      tz: 'Asia/Seoul',
      sex: 'female',
      dayBoundary: 'civil_midnight',
    })
    const bZi = ziweiChart({ birthDate: '1988-03-15', birthTime: '04:30', tz: 'Asia/Seoul', sex: 'male' })
    const bCivil = ziweiChart({
      birthDate: '1988-03-15',
      birthTime: '04:30',
      tz: 'Asia/Seoul',
      sex: 'male',
      dayBoundary: 'civil_midnight',
    })
    expect(aZi.flags.lunarDayRolled).toBe(false)
    expect(bZi.flags.lunarDayRolled).toBe(false)
    expect(aZi.mingGong).toEqual(aCivil.mingGong)
    expect(aZi.wuXingJu).toEqual(aCivil.wuXingJu)
    expect(aZi.palaces.map((p) => p.stars.filter((s) => s.category === 'major').map((s) => s.name))).toEqual(
      aCivil.palaces.map((p) => p.stars.filter((s) => s.category === 'major').map((s) => s.name)),
    )
    expect(bZi.mingGong).toEqual(bCivil.mingGong)
    expect(bZi.wuXingJu).toEqual(bCivil.wuXingJu)
  })
})

describe('14 主星 placement — 2000-08-16 寅时', () => {
  it('matches the published iztro reference chart', () => {
    const chart = ziweiChart({
      birthDate: '2000-08-16',
      birthTime: '04:00',
      tz: 'Asia/Seoul',
      sex: 'female',
    })
    const byBranch: Record<string, string[]> = {}
    for (const palace of chart.palaces) {
      byBranch[palace.branch] = palace.stars.filter((s) => s.category === 'major').map((s) => s.name)
    }
    expect(byBranch.寅).toEqual(['武曲', '天相'])
    expect(byBranch.卯).toEqual(['太阳', '天梁'])
    expect(byBranch.辰).toEqual(['七杀'])
    expect(byBranch.巳).toEqual(['天机'])
    expect(byBranch.午).toEqual(['紫微'])
    expect(byBranch.未).toEqual([])
    expect(byBranch.申).toEqual(['破军'])
    expect(byBranch.酉).toEqual([])
    expect(byBranch.戌).toEqual(['廉贞', '天府'])
    expect(byBranch.亥).toEqual(['太阴'])
    expect(byBranch.子).toEqual(['贪狼'])
    expect(byBranch.丑).toEqual(['天同', '巨门'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — 四化 / 大限 / 流年 / 廟旺
// ═══════════════════════════════════════════════════════════════════════

const CHART_A = { birthDate: '2000-08-16', birthTime: '04:00', tz: 'Asia/Seoul', sex: 'female' } as const
const CHART_B = { birthDate: '1988-03-15', birthTime: '04:30', tz: 'Asia/Seoul', sex: 'male' } as const

describe('生年四化 (natal 四化)', () => {
  it('matches the iztro default table for at least 5 stems', () => {
    // 甲 index 0
    expect(siHuaForStem(0)).toEqual({ stem: '甲', lu: '廉贞', quan: '破军', ke: '武曲', ji: '太阳' })
    // 乙 index 1
    expect(siHuaForStem(1)).toEqual({ stem: '乙', lu: '天机', quan: '天梁', ke: '紫微', ji: '太阴' })
    // 丙 index 2
    expect(siHuaForStem(2)).toEqual({ stem: '丙', lu: '天同', quan: '天机', ke: '文昌', ji: '廉贞' })
    // 戊 index 4
    expect(siHuaForStem(4)).toEqual({ stem: '戊', lu: '贪狼', quan: '太阴', ke: '右弼', ji: '天机' })
    // 庚 index 6 — 全書系 / iztro default (太陰化科)
    expect(siHuaForStem(6)).toEqual({ stem: '庚', lu: '太阳', quan: '武曲', ke: '太阴', ji: '天同' })
    // 癸 index 9
    expect(siHuaForStem(9)).toEqual({ stem: '癸', lu: '破军', quan: '巨门', ke: '太阴', ji: '贪狼' })
  })

  it('exposes the 庚 school variants without changing the default', () => {
    // Default 庚 uses 太陰化科 (全書系, matches iztro).
    expect(siHuaForStem(6).ke).toBe('太阴')
    // 中州派 puts 天府化科; iztro-doc example puts 天同化科 / 天相化忌.
    expect(MUTAGEN_GENG_VARIANTS.zhongzhou).toEqual(['太阳', '武曲', '天府', '天同'])
    expect(MUTAGEN_GENG_VARIANTS.iztroDoc).toEqual(['太阳', '武曲', '天同', '天相'])
    // All schools agree on 太陽祿 + 武曲權.
    for (const v of Object.values(MUTAGEN_GENG_VARIANTS)) {
      expect(v[0]).toBe('太阳')
      expect(v[1]).toBe('武曲')
    }
  })

  it('is present on the chart from the birth year stem (Chart A 庚辰)', () => {
    const chart = ziweiChart(CHART_A)
    expect(chart.lunar.yearStem).toBe('庚')
    expect(chart.siHua).toEqual({ stem: '庚', lu: '太阳', quan: '武曲', ke: '太阴', ji: '天同' })
  })

  it('is still computed when the birth time is unknown', () => {
    const chart = ziweiChart({ birthDate: '1988-03-15', birthTime: null, tz: 'Asia/Seoul', sex: 'male' })
    expect(chart.mingGong).toBeNull()
    expect(chart.siHua).toEqual({ stem: '戊', lu: '贪狼', quan: '太阴', ke: '右弼', ji: '天机' })
    expect(chart.daXian).toBeNull()
    expect(chart.limitations).toContain('no_feixing_sihua')
  })
})

describe('大限 direction — all four 陽男/陰男/陽女/陰女 cases', () => {
  it('陽男 順行, 陰女 順行; 陰男 逆行, 陽女 逆行 (陽 = even 天干 index)', () => {
    // 庚 (index 6, 陽)
    expect(daXianForward(6, 'male')).toBe(true) // 陽男 → 順
    expect(daXianForward(6, 'female')).toBe(false) // 陽女 → 逆
    // 辛 (index 7, 陰)
    expect(daXianForward(7, 'male')).toBe(false) // 陰男 → 逆
    expect(daXianForward(7, 'female')).toBe(true) // 陰女 → 順
  })

  it('Chart A (庚 陽 / female) runs 逆行 from 命宮', () => {
    const chart = ziweiChart(CHART_A)
    if (chart.daXian === null) throw new Error('expected daXian')
    expect(chart.daXian.forward).toBe(false)
    // 逆行: 午(6) → 巳(5) → 辰(4)
    expect(chart.daXian.periods.slice(0, 3).map((p) => p.palaceIndex)).toEqual([6, 5, 4])
  })

  it('Chart B (戊 陽 / male) runs 順行 from 命宮', () => {
    const chart = ziweiChart(CHART_B)
    if (chart.daXian === null) throw new Error('expected daXian')
    expect(chart.daXian.forward).toBe(true)
    // 順行: 子(0) → 丑(1) → 寅(2)
    expect(chart.daXian.periods.slice(0, 3).map((p) => p.palaceIndex)).toEqual([0, 1, 2])
  })
})

describe('大限 starting age = 五行局 number', () => {
  it('first 大限 begins at the 五行局 number, +10 per palace', () => {
    const dummy = Array.from({ length: 12 }, (_, i) => ({ name: '命', index: i })) as unknown as Palace[]
    for (const startAge of [2, 3, 4, 5, 6]) {
      const periods = buildDaXianPeriods(0, startAge, true, dummy)
      expect(periods).toHaveLength(12)
      expect(periods[0]!.ageFrom).toBe(startAge)
      expect(periods[0]!.ageTo).toBe(startAge + 9)
      expect(periods[1]!.ageFrom).toBe(startAge + 10)
      expect(periods[11]!.ageTo).toBe(startAge + 119)
    }
  })

  it('binds the 五行局 to the chart (水二局 → 2, 木三局 → 3, 金四局 → 4)', () => {
    const a = ziweiChart(CHART_A)
    const b = ziweiChart(CHART_B)
    const c = ziweiChart({ ...CHART_A, birthTime: '23:30' })
    expect(a.daXian?.startAge).toBe(3)
    expect(a.wuXingJu?.number).toBe(3)
    expect(b.daXian?.startAge).toBe(4)
    expect(b.wuXingJu?.number).toBe(4)
    expect(c.daXian?.startAge).toBe(2)
    expect(c.wuXingJu?.number).toBe(2)
  })

  it('currentDaXian is null without atDate and resolves the right period with it', () => {
    expect(ziweiChart(CHART_A).daXian?.currentDaXian).toBeNull()
    // 虚岁 27 in 2026 → 3rd 大限 (辰, 23–32) for Chart A.
    const withDate = ziweiChart({ ...CHART_A, atDate: '2026-06-01' })
    expect(withDate.daXian?.currentDaXian).toEqual({ palaceIndex: 4, palaceName: '夫妻', ageFrom: 23, ageTo: 32 })
  })
})

describe('流年宮 lands on the target year branch', () => {
  it('year 干支 comes from the year number', () => {
    expect(yearStemBranch(2026)).toEqual({ stem: 2, branch: 6 }) // 丙午
    expect(yearStemBranch(2024)).toEqual({ stem: 0, branch: 4 }) // 甲辰
    expect(yearStemBranch(1984)).toEqual({ stem: 0, branch: 0 }) // 甲子
  })

  it('流年宮 branch always equals the target year branch (Chart A)', () => {
    const chart = ziweiChart(CHART_A)
    for (const [year, branch] of [
      [2026, '午'],
      [2024, '辰'],
      [2020, '子'],
      [2023, '卯'],
    ] as const) {
      const ln = ziweiLiuNian(chart, year)
      expect(ln.yearBranch).toBe(branch)
      expect(ln.liuNianPalace.branch).toBe(branch)
      expect(ln.liuNianPalace.index).toBe(chart.palaces.find((p) => p.branch === branch)!.index)
    }
  })

  it('流年四化 uses the same table as 生年四化 (2026 丙 → 天同/天机/文昌/廉贞)', () => {
    const chart = ziweiChart(CHART_A)
    const ln = ziweiLiuNian(chart, 2026)
    expect(ln.yearStem).toBe('丙')
    expect(ln.liuNianSiHua).toEqual({ stem: '丙', lu: '天同', quan: '天机', ke: '文昌', ji: '廉贞' })
  })

  it('小限 follows 起宮 by year branch then 男順女逆', () => {
    // Chart A female, birth 辰 → 起 戌; 虚岁 27 (2026) → 申 福德.
    expect(ziweiLiuNian(ziweiChart(CHART_A), 2026).xiaoXian).toEqual({
      palaceIndex: 8,
      palaceName: '福德',
      nominalAge: 27,
    })
    // Chart B male, birth 辰 → 起 戌; 虚岁 39 (2026) → 子 命.
    expect(ziweiLiuNian(ziweiChart(CHART_B), 2026).xiaoXian).toEqual({
      palaceIndex: 0,
      palaceName: '命',
      nominalAge: 39,
    })
  })

  it('throws when asked for 流年 on a chart with no birth time', () => {
    const chart = ziweiChart({ ...CHART_A, birthTime: null })
    expect(() => ziweiLiuNian(chart, 2026)).toThrow(/birth time/)
  })
})

describe('廟旺利陷 (brightness)', () => {
  it('marks a known 廟 star: 紫微 in 午 (Chart A)', () => {
    const chart = ziweiChart(CHART_A)
    const wei = chart.palaces.find((p) => p.branch === '午')!
    const ziwei = wei.stars.find((s) => s.name === '紫微')!
    expect(ziwei.brightness).toBe('庙')
  })

  it('marks a known 陷 star: 天机 in 未 (Chart B)', () => {
    const chart = ziweiChart(CHART_B)
    const weiPalace = chart.palaces.find((p) => p.branch === '未')!
    const tianji = weiPalace.stars.find((s) => s.name === '天机')!
    expect(tianji.brightness).toBe('陷')
  })

  it('returns null (no brightness key) for stars iztro has no table for (左辅)', () => {
    const chart = ziweiChart(CHART_A)
    const zuofu = chart.palaces.flatMap((p) => p.stars).find((s) => s.name === '左辅')!
    expect(zuofu.brightness).toBeUndefined()
    expect(chart.limitations).toContain('brightness_gaps')
  })
})
