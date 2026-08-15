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

describe('nineStar — day star (気学 日盤)', () => {
  const tz = 'Asia/Tokyo'
  const dayOf = (date: string) => nineStar({ date, time: '12:00', timezone: tz }).day.number

  it('1988-03-15 is 3 (acceptance; 9rando + watashino)', () => {
    expect(dayOf('1988-03-15')).toBe(3)
  })

  it('matches 9rando / watashino on 冬至 and 夏至 switch neighbourhoods', () => {
    expect(dayOf('1987-12-22')).toBe(1) // 冬至; 9rando + watashino 一白
    expect(dayOf('1988-06-21')).toBe(2) // 夏至; 9rando + watashino 二黒
    expect(dayOf('1988-06-22')).toBe(3) // day after 夏至; 9rando 三碧
    expect(dayOf('1988-12-21')).toBe(5) // 冬至; 9rando 五黄
  })

  it('matches the nobml 九星閏 worked example (2008 winter)', () => {
    expect(dayOf('2008-12-20')).toBe(7) // 甲午 七赤 陽遁 start
    expect(dayOf('2008-12-31')).toBe(9)
  })

  it('matches 9rando on a summer 閏 year and two mid-range dates', () => {
    expect(dayOf('1997-06-21')).toBe(3) // 夏至 甲午 三碧; 9rando
    expect(dayOf('2000-01-01')).toBe(6) // watashino 六白
    expect(dayOf('1986-10-19')).toBe(7) // watashino 七赤
  })

  it('stays in 1–9 at range edges and later 閏 years (values not pinned; schools diverge)', () => {
    for (const date of ['1901-06-21', '2019-12-22', '2031-12-22', '2099-12-22']) {
      const n = dayOf(date)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(9)
    }
  })
})

describe('九星 日盤 120-day compression frequency (scan only; not implemented)', () => {
  it('counts civil dates in 1900–2100 whose day-star path hits the 120-day throw', () => {
    const firstDates: string[] = []
    let dateCount = 0
    for (let year = 1900; year <= 2100; year++) {
      try {
        nineStar({ date: `${year}-06-15`, time: '12:00', timezone: 'Asia/Tokyo' })
      } catch (err) {
        const message = err instanceof Error ? err.message : ''
        if (!message.includes('120-day')) continue
        const days = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365
        dateCount += days
        if (firstDates.length < 5) firstDates.push(`${year}-01-01`)
      }
    }
    // Recorded in docs/nine-star-verification.md. Expected 0 inside 1900–2100 (nobml: 40c–85c).
    expect({ dateCount, firstDates }).toEqual({ dateCount: 0, firstDates: [] })
  })
})
