import { describe, expect, it } from 'vitest'
import { fiveElementBalance, fourPillars, seasonElement, solarTerms, sukuyou, tenGods, tzolkin } from '..'

describe('solarTerms', () => {
  it('returns exactly 24 terms per year, in chronological order, matching the verified 1988 reference', () => {
    const terms = solarTerms(1988)
    expect(terms.length).toBe(24)
    for (let i = 1; i < terms.length; i++) {
      expect(new Date(terms[i]!.utcIso).getTime()).toBeGreaterThan(new Date(terms[i - 1]!.utcIso).getTime())
    }
    expect(terms[0]!.hangul).toBe('소한')
    expect(terms.at(-1)!.hangul).toBe('동지')
    // 립춘 1988 per lunar-javascript (22:42:49 CST label -> UTC), within ~30s of the
    // independent ephemeris cross-check in docs/calendar-verification.md (14:43:18Z).
    const licun = terms.find((t) => t.hangul === '입춘')!
    expect(licun.utcIso).toBe('1988-02-04T14:42:49.000Z')
  })

  it('12 of the 24 are jie (with a month-branch), 12 are qi (without)', () => {
    const terms = solarTerms(2000)
    expect(terms.filter((t) => t.isJie).length).toBe(12)
    expect(terms.filter((t) => !t.isJie).length).toBe(12)
    expect(terms.filter((t) => t.branchIndexIfJie !== null).length).toBe(12)
  })
})

describe('fiveElementBalance', () => {
  it('matches the verified reference chart (戊辰 乙卯 己巳 丙寅 -> 土土 木木 土火 火木)', () => {
    const p = fourPillars({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
    expect(fiveElementBalance(p)).toEqual({ wood: 3, fire: 2, earth: 3, metal: 0, water: 0 })
  })

  it('sums to 6 when the hour is unknown, 8 when known', () => {
    const known = fourPillars({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
    const unknown = fourPillars({ date: '1988-03-15', time: null, timezone: 'Asia/Seoul' })
    const sum = (c: ReturnType<typeof fiveElementBalance>) => c.wood + c.fire + c.earth + c.metal + c.water
    expect(sum(fiveElementBalance(known))).toBe(8)
    expect(sum(fiveElementBalance(unknown))).toBe(6)
  })
})

describe('tenGods', () => {
  it('marks the day stem as 일간 (day master), not a ten-god relationship', () => {
    const p = fourPillars({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
    const gods = tenGods(p.day.stem, p)
    expect(gods.day.stem).toBe('일간')
  })

  it('matches library-verified stem-based labels for the reference chart (year 겁재, month 편관/七殺, hour 정인)', () => {
    const p = fourPillars({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
    const gods = tenGods(p.day.stem, p)
    expect(gods.year.stem).toBe('겁재')
    expect(gods.month.stem).toBe('편관')
    expect(gods.hour?.stem).toBe('정인')
  })
})

describe('seasonElement', () => {
  it('returns WOOD in early spring, well outside the 18-day Earth buffer', () => {
    expect(seasonElement({ date: '1988-03-15', time: '12:00', timezone: 'Asia/Seoul' })).toBe('WOOD')
  })

  it('returns EARTH inside the ~18 days immediately before 입하 (1988-05-05)', () => {
    expect(seasonElement({ date: '1988-04-25', time: '12:00', timezone: 'Asia/Seoul' })).toBe('EARTH')
  })

  it('returns FIRE just after 입하 crosses into summer', () => {
    expect(seasonElement({ date: '1988-05-10', time: '12:00', timezone: 'Asia/Seoul' })).toBe('FIRE')
  })
})

describe('tzolkin', () => {
  it('matches the well-documented GMT-correlation reference date: 2012-12-21 = 4 Ajaw', () => {
    const r = tzolkin({ date: '2012-12-21' })
    expect(r.tone).toBe(4)
    expect(r.nawalName).toBe('Ajaw')
    expect(r.nawal).toBe(20)
  })

  it('advances by exactly 1 nawal and 1 tone on consecutive days', () => {
    const a = tzolkin({ date: '2012-12-21' })
    const b = tzolkin({ date: '2012-12-22' })
    expect(b.nawal).toBe(a.nawal === 20 ? 1 : a.nawal + 1)
    expect(b.tone).toBe(a.tone === 13 ? 1 : a.tone + 1)
  })
})

describe('sukuyou', () => {
  it('returns an index in range 1-27 and flags reduced precision when time is unknown', () => {
    const known = sukuyou({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
    expect(known.index).toBeGreaterThanOrEqual(1)
    expect(known.index).toBeLessThanOrEqual(27)
    expect(known.timeUnknown).toBe(false)

    const unknown = sukuyou({ date: '1988-03-15', time: null, timezone: 'Asia/Seoul' })
    expect(unknown.timeUnknown).toBe(true)
  })
})
