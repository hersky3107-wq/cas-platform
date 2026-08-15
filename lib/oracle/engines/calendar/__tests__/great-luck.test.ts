import { describe, expect, it } from 'vitest'
import { greatLuck, CalendarInputError } from '..'

describe('greatLuck — direction by sex and year-stem polarity', () => {
  it('yang year (1988, 戊) + male = forward (순행)', () => {
    const r = greatLuck({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul', sex: 'male' })
    expect(r.forward).toBe(true)
    expect(r.startAge).toBe(8)
  })

  it('yang year (1988, 戊) + female = backward (역행)', () => {
    const r = greatLuck({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul', sex: 'female' })
    expect(r.forward).toBe(false)
  })

  it('yin year (1987, 丁) + male = backward (역행) — opposite of the yang-year case', () => {
    const r = greatLuck({ date: '1987-03-15', time: '04:30', timezone: 'Asia/Seoul', sex: 'male' })
    expect(r.forward).toBe(false)
  })

  it('yin year (1987, 丁) + female = forward (순행)', () => {
    const r = greatLuck({ date: '1987-03-15', time: '04:30', timezone: 'Asia/Seoul', sex: 'female' })
    expect(r.forward).toBe(true)
  })

  it('produces a sequence of periods with each ganzhi advancing by exactly 1 in the 60-cycle', () => {
    const r = greatLuck({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul', sex: 'male' })
    expect(r.periods.length).toBeGreaterThan(5)
    for (let i = 1; i < r.periods.length; i++) {
      const prev = r.periods[i - 1]!
      const cur = r.periods[i]!
      expect(cur.stem.index).toBe((prev.stem.index + 1) % 10)
      expect(cur.branch.index).toBe((prev.branch.index + 1) % 12)
      expect(cur.startAge).toBe(prev.endAge + 1)
    }
  })

  it('throws a typed error when birth time is unknown (대운수 needs the exact day-distance to a jie boundary)', () => {
    expect(() =>
      greatLuck({ date: '1988-03-15', time: null, timezone: 'Asia/Seoul', sex: 'male' }),
    ).toThrow(CalendarInputError)
  })
})
