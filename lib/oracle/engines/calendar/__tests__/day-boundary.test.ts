import { describe, expect, it } from 'vitest'
import { fiveElementBalance, fourPillars, nineStar, sukuyou, tenGods, tzolkin, weekday } from '..'

const tz = 'Asia/Seoul'
const late = { date: '1988-03-15', time: '23:30', timezone: tz } as const
const nextEarly = { date: '1988-03-16', time: '00:30', timezone: tz } as const
const noon = { date: '1988-03-15', time: '04:30', timezone: tz } as const

describe('dayBoundary — 1988-03-15 04:30 must not move', () => {
  it('keeps the triple-checked 戊辰 乙卯 己巳 丙寅 under both conventions', () => {
    const zi = fourPillars({ ...noon, dayBoundary: 'zi_start' })
    const civil = fourPillars({ ...noon, dayBoundary: 'civil_midnight' })
    expect(zi.year.ganzhi).toBe('戊辰')
    expect(zi.month.ganzhi).toBe('乙卯')
    expect(zi.day.ganzhi).toBe('己巳')
    expect(zi.hour?.ganzhi).toBe('丙寅')
    expect(civil.day.ganzhi).toBe('己巳')
    expect(civil.hour?.ganzhi).toBe('丙寅')
    expect(zi.alternate).toBeNull()
    expect(civil.alternate).toBeNull()
  })
})

describe('dayBoundary — 23:30 vs 00:30', () => {
  it('zi_start at 23:30 advances the day pillar; civil_midnight does not', () => {
    const zi = fourPillars({ ...late, dayBoundary: 'zi_start' })
    const civil = fourPillars({ ...late, dayBoundary: 'civil_midnight' })
    expect(zi.day.ganzhi).toBe('庚午')
    expect(zi.hour?.ganzhi).toBe('丙子')
    expect(civil.day.ganzhi).toBe('己巳')
    expect(civil.hour?.ganzhi).toBe('甲子')
    expect(zi.year.ganzhi).toBe(civil.year.ganzhi)
    expect(zi.month.ganzhi).toBe(civil.month.ganzhi)
  })

  it('returns alternate only at 23:00–23:59, with the other convention', () => {
    const zi = fourPillars({ ...late, dayBoundary: 'zi_start' })
    const noonP = fourPillars(noon)
    const nextP = fourPillars(nextEarly)
    expect(zi.alternate).not.toBeNull()
    expect(zi.alternate?.dayBoundaryUsed).toBe('civil_midnight')
    expect(zi.alternate?.day.ganzhi).toBe('己巳')
    expect(zi.alternate?.hour?.ganzhi).toBe('甲子')
    expect(noonP.alternate).toBeNull()
    expect(nextP.alternate).toBeNull()
  })

  it('00:30 the next day matches zi_start 23:30 on day and hour (year/month unchanged here)', () => {
    const ziLate = fourPillars({ ...late, dayBoundary: 'zi_start' })
    const next = fourPillars(nextEarly)
    expect(next.day.ganzhi).toBe(ziLate.day.ganzhi)
    expect(next.hour?.ganzhi).toBe(ziLate.hour?.ganzhi)
    expect(next.dayBoundaryUsed).toBe('zi_start')
  })

  it('hour stem and 십신 follow the active day stem', () => {
    const zi = fourPillars({ ...late, dayBoundary: 'zi_start' })
    const civil = fourPillars({ ...late, dayBoundary: 'civil_midnight' })
    const ziGods = tenGods(zi.day.stem, zi)
    const civilGods = tenGods(civil.day.stem, civil)
    expect(zi.day.stem.hanja).toBe('庚')
    expect(civil.day.stem.hanja).toBe('己')
    expect(zi.hour?.stem.hanja).toBe('丙')
    expect(civil.hour?.stem.hanja).toBe('甲')
    expect(ziGods.day.stem).toBe('일간')
    expect(civilGods.day.stem).toBe('일간')
    expect(ziGods.hour?.stem).not.toBe(civilGods.hour?.stem)
    expect(fiveElementBalance(zi)).not.toEqual(fiveElementBalance(civil))
  })
})

describe('dayBoundary must not leak into civil-date systems', () => {
  it('weekday at 23:30 is still the civil Tuesday, not Wednesday', () => {
    expect(weekday(late)).toBe(weekday({ date: '1988-03-15', time: '12:00', timezone: tz }))
    expect(weekday(late)).not.toBe(weekday({ date: '1988-03-16', time: '00:30', timezone: tz }))
  })

  it('구성 일명성 follows the civil date, not the rolled day pillar', () => {
    const at2330 = nineStar(late).day.number
    const atNoon = nineStar({ date: '1988-03-15', time: '12:00', timezone: tz }).day.number
    const nextDay = nineStar(nextEarly).day.number
    expect(at2330).toBe(atNoon)
    expect(at2330).not.toBe(nextDay)
  })

  it('숙요 follows the civil date, not the rolled day pillar', () => {
    expect(sukuyou(late).hanja).toBe(sukuyou({ date: '1988-03-15', time: '12:00', timezone: tz }).hanja)
    expect(sukuyou(late).hanja).not.toBe(sukuyou(nextEarly).hanja)
  })

  it('촐킨 is a civil-date count', () => {
    expect(tzolkin({ date: '1988-03-15' })).toEqual(tzolkin({ date: '1988-03-15' }))
    expect(tzolkin({ date: '1988-03-15' }).nawal).not.toBe(tzolkin({ date: '1988-03-16' }).nawal)
  })
})
