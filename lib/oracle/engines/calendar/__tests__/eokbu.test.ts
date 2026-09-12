/**
 * 억부 용신 — fixtures are published 팔자, not scores reverse-engineered
 * from this file. 1988-03-15 is the engine's triple-checked 만세력 chart.
 */
import { describe, expect, it } from 'vitest'
import { CALENDAR_ENGINE_VERSION, eokbu, EOKBU_JONGGYEOK, EOKBU_THRESHOLD, fourPillars } from '..'
import { HIDDEN_STEMS } from '../tables'

function palja(p: ReturnType<typeof fourPillars>) {
  return [p.year.ganzhi, p.month.ganzhi, p.day.ganzhi, p.hour?.ganzhi ?? '—'].join(' ')
}

describe('calendar engine version', () => {
  it('bumps to 1.5.0 with the 5/8 종격 cutoff', () => {
    expect(CALENDAR_ENGINE_VERSION).toBe('1.5.0')
    expect(EOKBU_THRESHOLD).toEqual({ weakMax: 2, strongMin: 5 })
    expect(EOKBU_JONGGYEOK).toEqual({ numerator: 5, denominator: 8, minLead: 2 })
  })
})

describe('지장간 배장', () => {
  it('寅 본기는 甲, 午 중기는 己', () => {
    const yin = HIDDEN_STEMS[2]!
    expect(yin.find((h) => h.role === 'ben')?.stemIndex).toBe(0)
    const wu = HIDDEN_STEMS[6]!
    expect(wu.find((h) => h.role === 'zhong')?.stemIndex).toBe(5)
  })
})

describe('eokbu — 신약 (己토 卯월 무근)', () => {
  it('1988-03-15 04:30 戊辰 乙卯 己巳 丙寅 → 신약, 용신 화', () => {
    // docs/calendar-verification.md: 戊辰 乙卯 己巳 丙寅. 己토, 卯월 목극토
    // (실령). 지장간 己는 丑·未 본기·午 중기뿐 — 이 네 지지에 없음.
    const p = fourPillars({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
    expect(palja(p)).toBe('戊辰 乙卯 己巳 丙寅')
    const r = eokbu(p)
    expect(r.deukryeong.has).toBe(false)
    expect(r.deukryeong.score).toBe(0)
    expect(r.deukji.score).toBe(0)
    expect(r.deukse.score).toBe(2)
    expect(r.total).toBeLessThanOrEqual(2)
    expect(r.strength).toBe('weak')
    expect(r.yongsin).toBe('fire')
    expect(r.huisin).toBe('earth')
    expect(r.gisin).toBe('water')
    expect(r.inapplicable).toBeNull()
  })
})

describe('eokbu — 신강 (갑목 인월 득령+통근)', () => {
  it('1984-02-10 12:00 甲子 丙寅 甲戌 庚午 → 신강, 용신 화', () => {
    // 甲목, 寅월 본기 목 = 득령 왕. 월지 寅에 甲 정기 통근. 년간 甲 비겁.
    // 억부 신강 용신 = 식상 화. 조후 인월 목왕 would pick 금 — not this pass.
    const p = fourPillars({ date: '1984-02-10', time: '12:00', timezone: 'Asia/Seoul' })
    expect(palja(p)).toBe('甲子 丙寅 甲戌 庚午')
    const r = eokbu(p)
    expect(r.deukryeong.has).toBe(true)
    expect(r.deukryeong.relation).toBe('wang')
    expect(r.deukji.roots.some((root) => root.branchHanja === '寅' && root.role === 'ben')).toBe(true)
    expect(r.deukji.score).toBe(1)
    expect(r.deukse.score).toBe(2)
    expect(r.total).toBe(6)
    expect(r.strength).toBe('strong')
    expect(r.yongsin).toBe('fire')
    expect(r.huisin).toBe('earth')
    expect(r.gisin).toBe('water')
    expect(r.inapplicable).toBeNull()
  })
})

describe('eokbu — missing birth time', () => {
  it('same 己卯월 chart without 시주 still 신약, and flags the missing hour', () => {
    const p = fourPillars({ date: '1988-03-15', time: null, timezone: 'Asia/Seoul' })
    expect(p.hour).toBeNull()
    const r = eokbu(p)
    expect(r.hourUnknown).toBe(true)
    expect(r.deukse.helpers.some((h) => h.pillar === 'hour')).toBe(false)
    expect(r.deukji.roots.some((root) => root.pillar === 'hour')).toBe(false)
    expect(r.deukse.score).toBe(2)
    expect(r.strength).toBe('weak')
    expect(r.yongsin).toBe('fire')
  })
})

describe('eokbu — 4/8 is ordinary, not 종격', () => {
  it('1984-02-10 04:30 甲子 丙寅 甲戌 丙寅 → 목 4/8, 신강 용신 화', () => {
    // Same civil day as the 신강 fixture, 인시: 甲甲 + 寅寅 = 목 4, 화 2.
    // 4 of 8 with a gap of 2 used to fire as 종격; that cutoff is ordinary.
    const p = fourPillars({ date: '1984-02-10', time: '04:30', timezone: 'Asia/Seoul' })
    expect(palja(p)).toBe('甲子 丙寅 甲戌 丙寅')
    const r = eokbu(p)
    expect(r.inapplicable).toBeNull()
    expect(r.strength).toBe('strong')
    expect(r.yongsin).toBe('fire')
  })
})

describe('eokbu — 종격 판정불가 (편왕)', () => {
  it('1980-01-08 04:30 己未 丁丑 庚辰 戊寅 → 토 5/8, no 용신', () => {
    const p = fourPillars({ date: '1980-01-08', time: '04:30', timezone: 'Asia/Seoul' })
    expect(palja(p)).toBe('己未 丁丑 庚辰 戊寅')
    const r = eokbu(p)
    expect(r.inapplicable).toEqual({ code: 'jonggyeok_dominant', element: 'earth', count: 5, chars: 8 })
    expect(r.yongsin).toBeNull()
    expect(r.huisin).toBeNull()
    expect(r.gisin).toBeNull()
    expect(r.strength).toBeNull()
  })
})

describe('eokbu — 중화 does not pick a side', () => {
  it('1984-02-15 12:00 己卯 인월 약한 조력 → 중화, 용신 없음', () => {
    const p = fourPillars({ date: '1984-02-15', time: '12:00', timezone: 'Asia/Seoul' })
    expect(palja(p)).toBe('甲子 丙寅 己卯 庚午')
    const r = eokbu(p)
    expect(r.strength).toBe('balanced')
    expect(r.yongsin).toBeNull()
    expect(r.deukryeong.score).toBe(0)
    expect(r.deukji.score).toBe(1)
    expect(r.deukse.score).toBe(2)
    expect(r.total).toBe(3)
  })
})
