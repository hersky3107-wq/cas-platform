import { describe, expect, it } from 'vitest'
import { sukuyou, sukuyouRelation } from '..'

const tz = 'Asia/Tokyo'
const of = (date: string) => sukuyou({ date, time: '12:00', timezone: tz })

describe('sukuyou — 朔日宿 (Japanese 旧暦)', () => {
  it('1988-03-15 is 危宿 (acceptance; Japanese references, not 氐宿)', () => {
    const r = of('1988-03-15')
    expect(r.hanja).toBe('危宿')
    expect(r.index).toBe(22)
    expect(r.lunarYear).toBe(1988)
    expect(r.lunarMonth).toBe(1)
    expect(r.lunarDay).toBe(27)
    expect(r.isLeapMonth).toBe(false)
  })

  it('matches senjutsu.jp + watashino on the published 1986-10-19 worked example', () => {
    const r = of('1986-10-19')
    expect(r.hanja).toBe('畢宿')
    expect(r.lunarYear).toBe(1986)
    expect(r.lunarMonth).toBe(9)
    expect(r.lunarDay).toBe(16)
  })

  it('matches watashino 二十七宿 on five further civil dates', () => {
    expect(of('2000-01-01').hanja).toBe('心宿')
    expect(of('1990-08-16').hanja).toBe('參宿')
    expect(of('1987-12-22').hanja).toBe('女宿')
    expect(of('1988-06-21').hanja).toBe('軫宿')
    expect(of('1988-08-25').hanja).toBe('危宿')
    expect(of('1988-04-01').hanja).toBe('角宿')
  })

  it('does not change the mansion when time is omitted', () => {
    const timed = sukuyou({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
    const bare = sukuyou({ date: '1988-03-15', time: null, timezone: 'Asia/Seoul' })
    expect(timed.hanja).toBe('危宿')
    expect(bare.hanja).toBe('危宿')
  })
})

describe('sukuyouRelation — 三九の秘法', () => {
  it('offset 0/9/18 are 命/業/胎 (senjutsu.jp)', () => {
    expect(sukuyouRelation(1, 1).name).toBe('命')
    expect(sukuyouRelation(1, 10).name).toBe('業')
    expect(sukuyouRelation(1, 19).name).toBe('胎')
    expect(sukuyouRelation(1, 10).pair).toBe('業胎')
  })

  it('is directional: A→B 栄 iff B→A 親', () => {
    const ab = sukuyouRelation(1, 2)
    const ba = sukuyouRelation(2, 1)
    expect(ab.name).toBe('栄')
    expect(ba.name).toBe('親')
    expect(ab.pair).toBe('栄親')
    expect(ba.pair).toBe('栄親')
  })
})
