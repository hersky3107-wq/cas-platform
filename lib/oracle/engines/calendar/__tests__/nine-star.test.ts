import { describe, expect, it } from 'vitest'
import { nineStar } from '..'

describe('nineStar — year star uses the 입춘 boundary, not Jan 1', () => {
  it('a birth between Jan 1 and 입춘 (1988-02-04) is assigned the PREVIOUS year for star purposes', () => {
    // Jan 15 1988 is before that year's LiChun, so it must use qi-year 1987, not calendar-year 1988.
    const jan15 = nineStar({ date: '1988-01-15', time: '12:00', timezone: 'Asia/Seoul' })
    const mar15 = nineStar({ date: '1988-03-15', time: '12:00', timezone: 'Asia/Seoul' })
    // If year-star were (incorrectly) computed from the plain calendar year, both would match.
    expect(jan15.year.number).not.toBe(mar15.year.number)
  })

  it('matches the publicly documented worked example: 1951년생 -> 사록목성(4)', () => {
    // Source: sajuplus.tistory.com/2629 ("본명성 쉽게 구하는 방법"), example #1.
    // A mid-year date safely after that year's LiChun so the qi-year equals the calendar year.
    const r = nineStar({ date: '1951-06-15', time: '12:00', timezone: 'Asia/Seoul' })
    expect(r.year.number).toBe(4)
  })
})

describe('nineStar — month star uses jieqi (절) boundaries, not calendar months', () => {
  it('Feb 1 and Feb 10 1988 straddle the 입춘 jie (Feb 4) and land in different ganzhi months', () => {
    const feb1 = nineStar({ date: '1988-02-01', time: '12:00', timezone: 'Asia/Seoul' })
    const feb10 = nineStar({ date: '1988-02-10', time: '12:00', timezone: 'Asia/Seoul' })
    expect(feb1.month.number).not.toBe(feb10.month.number)
  })

  it('Jan 25 and Feb 1 1988 are both in the same 소한-to-입춘 jie period and share the same month star', () => {
    const jan25 = nineStar({ date: '1988-01-25', time: '12:00', timezone: 'Asia/Seoul' })
    const feb1 = nineStar({ date: '1988-02-01', time: '12:00', timezone: 'Asia/Seoul' })
    expect(jan25.month.number).toBe(feb1.month.number)
  })
})

describe('nineStar — day star (library-derived, flagged 유파 gap)', () => {
  it('returns a value in range 1-9 without throwing', () => {
    const r = nineStar({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
    expect(r.day.number).toBeGreaterThanOrEqual(1)
    expect(r.day.number).toBeLessThanOrEqual(9)
  })
})
