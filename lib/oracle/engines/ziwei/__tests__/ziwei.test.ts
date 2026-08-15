import { describe, expect, it } from 'vitest'
import { fourPillars, toLunar } from '../../calendar'
import {
  MAJOR_STAR_NAMES,
  ZIWEI_ENGINE_VERSION,
  mingGongBranch,
  palaceStem,
  tianfuBranch,
  wuHuDunYinStem,
  ziweiBranch,
  ziweiChart,
} from '..'

describe('ziwei engine version', () => {
  it('exports ZIWEI_ENGINE_VERSION', () => {
    expect(ZIWEI_ENGINE_VERSION).toBe('1.1.0')
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
    expect(chart.limitations).toEqual([])
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
    expect(chart.limitations).toEqual(['no_birth_time'])
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
