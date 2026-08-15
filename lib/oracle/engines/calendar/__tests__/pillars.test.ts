import { describe, expect, it } from 'vitest'
import { fourPillars, toLunar, toSolar, CalendarRangeError } from '..'

describe('fourPillars — verified reference case', () => {
  it('matches the triple-cross-checked 1988-03-15 04:30 Asia/Seoul reference (see docs/calendar-verification.md)', () => {
    const p = fourPillars({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
    expect(p.year.ganzhi).toBe('戊辰')
    expect(p.month.ganzhi).toBe('乙卯')
    expect(p.day.ganzhi).toBe('己巳')
    expect(p.hour?.ganzhi).toBe('丙寅')
    expect(p.hourUnknown).toBe(false)
    expect(p.dayBoundaryUsed).toBe('zi_start')
    expect(p.alternate).toBeNull()
  })
})

describe('fourPillars — 입춘 year boundary', () => {
  it('births on Feb 3 and Feb 5 of the same Gregorian year get different year pillars', () => {
    // 1988 LiChun was 1988-02-04 (22:42:49 CST label / 23:43 KST) — Feb 3 is before it, Feb 5 is after.
    const feb3 = fourPillars({ date: '1988-02-03', time: '12:00', timezone: 'Asia/Seoul' })
    const feb5 = fourPillars({ date: '1988-02-05', time: '12:00', timezone: 'Asia/Seoul' })
    expect(feb3.year.ganzhi).not.toBe(feb5.year.ganzhi)
    expect(feb3.year.ganzhi).toBe('丁卯')
    expect(feb5.year.ganzhi).toBe('戊辰')
  })
})

describe('fourPillars — precise jieqi-boundary crossing (within 1 hour)', () => {
  // True LiChun 1988 instant (independently computed via astronomy-engine) = 1988-02-04T14:43:18Z = 23:43 KST.
  it('a birth 13 minutes before the boundary gets the pre-boundary pillar', () => {
    const p = fourPillars({ date: '1988-02-04', time: '23:30', timezone: 'Asia/Seoul' })
    expect(p.year.ganzhi).toBe('丁卯')
    expect(p.month.ganzhi).toBe('癸丑')
  })

  it('a birth 7 minutes after the boundary gets the post-boundary pillar', () => {
    const p = fourPillars({ date: '1988-02-04', time: '23:50', timezone: 'Asia/Seoul' })
    expect(p.year.ganzhi).toBe('戊辰')
    expect(p.month.ganzhi).toBe('甲寅')
  })
})

describe('fourPillars — timezone correctness', () => {
  it('same wall-clock time in Asia/Seoul and Asia/Tokyo (both UTC+9) yields identical pillars', () => {
    const seoul = fourPillars({ date: '1988-02-04', time: '23:30', timezone: 'Asia/Seoul' })
    const tokyo = fourPillars({ date: '1988-02-04', time: '23:30', timezone: 'Asia/Tokyo' })
    expect(tokyo.year.ganzhi).toBe(seoul.year.ganzhi)
    expect(tokyo.month.ganzhi).toBe(seoul.month.ganzhi)
  })

  it('same wall-clock digits in a different UTC offset (Asia/Kolkata, UTC+5:30) is a different absolute instant and can cross the boundary differently', () => {
    // Asia/Kolkata 23:30 = UTC 18:00 = KST 03:00 (next day) — well after the LiChun instant that Seoul 23:30 precedes.
    const seoul = fourPillars({ date: '1988-02-04', time: '23:30', timezone: 'Asia/Seoul' })
    const kolkata = fourPillars({ date: '1988-02-04', time: '23:30', timezone: 'Asia/Kolkata' })
    expect(seoul.year.ganzhi).toBe('丁卯')
    expect(kolkata.year.ganzhi).toBe('戊辰')
    expect(kolkata.year.ganzhi).not.toBe(seoul.year.ganzhi)
  })
})

describe('fourPillars — day pillar continuity (60 갑자 cycle)', () => {
  function expectNextDayAdvancesByOne(dateA: string, dateB: string) {
    const a = fourPillars({ date: dateA, time: '12:00', timezone: 'Asia/Seoul' })
    const b = fourPillars({ date: dateB, time: '12:00', timezone: 'Asia/Seoul' })
    expect(b.day.stem.index).toBe((a.day.stem.index + 1) % 10)
    expect(b.day.branch.index).toBe((a.day.branch.index + 1) % 12)
  }

  it('advances by exactly 1 across a month boundary', () => {
    expectNextDayAdvancesByOne('1988-03-31', '1988-04-01')
  })

  it('advances by exactly 1 across a year boundary', () => {
    expectNextDayAdvancesByOne('1999-12-31', '2000-01-01')
  })

  it('advances by exactly 1 across a leap-year Feb 29 boundary', () => {
    expectNextDayAdvancesByOne('2024-02-28', '2024-02-29')
    expectNextDayAdvancesByOne('2024-02-29', '2024-03-01')
  })

  it('advances by exactly 1 in a non-leap year (Feb 28 -> Mar 1 directly)', () => {
    expectNextDayAdvancesByOne('2023-02-28', '2023-03-01')
  })
})

describe('fourPillars — unknown birth time', () => {
  it('returns hour: null and hourUnknown: true without throwing', () => {
    const p = fourPillars({ date: '1988-03-15', time: null, timezone: 'Asia/Seoul' })
    expect(p.hour).toBeNull()
    expect(p.hourUnknown).toBe(true)
    expect(p.year.ganzhi).toBe('戊辰')
    expect(p.day.ganzhi).toBe('己巳')
  })
})

describe('toLunar / toSolar', () => {
  it('round-trips the verified reference date', () => {
    const lunar = toLunar({ date: '1988-03-15' })
    expect(lunar).toEqual({ year: 1988, month: 1, day: 28, isLeapMonth: false })
    const solar = toSolar(lunar)
    expect(solar).toEqual({ date: '1988-03-15' })
  })

  it('round-trips a leap lunar month (2023 闰二月)', () => {
    const solar = toSolar({ year: 2023, month: 2, day: 1, isLeapMonth: true })
    const lunar = toLunar(solar)
    expect(lunar).toEqual({ year: 2023, month: 2, day: 1, isLeapMonth: true })
  })
})

describe('range validation', () => {
  it('throws a typed CalendarRangeError outside 1900-2100', () => {
    expect(() => toLunar({ date: '1899-12-31' })).toThrow(CalendarRangeError)
    expect(() => toLunar({ date: '2101-01-01' })).toThrow(CalendarRangeError)
  })
})
