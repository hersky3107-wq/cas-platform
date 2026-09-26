import { describe, expect, it } from 'vitest'
import { eokbu, fiveElementBalance, fourPillars, tenGods } from '../../engines/calendar'
import { computeTalisman } from '../compute'
import { absentFromPillars, resolveSecondary } from '../secondary'
import { charts1988, EMPTY_CHARTS, fakeConsensus, LIVE_ACCESS } from './fixture'

describe('resolveSecondary', () => {
  it('1988-03-15 timed: metal and water are 0; centre fire → pick metal', () => {
    const pillars = fourPillars({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
    expect(fiveElementBalance(pillars)).toEqual({ wood: 3, fire: 2, earth: 3, metal: 0, water: 0 })
    expect(absentFromPillars(pillars)).toEqual(['metal', 'water'])
    expect(resolveSecondary({ pillars, centreElement: 'fire' })).toEqual({
      element: 'metal',
      source: 'saju-absent',
    })
  })

  it('1988-03-15 untimed still misses metal then water (6 characters)', () => {
    const pillars = fourPillars({ date: '1988-03-15', time: null, timezone: 'Asia/Seoul' })
    expect(pillars.hour).toBeNull()
    expect(fiveElementBalance(pillars)).toEqual({ wood: 2, fire: 1, earth: 3, metal: 0, water: 0 })
    expect(resolveSecondary({ pillars, centreElement: 'fire' })?.element).toBe('metal')
  })

  it('1984-02-10 has every 오행 — secondary is null', () => {
    const pillars = fourPillars({ date: '1984-02-10', time: '12:00', timezone: 'Asia/Seoul' })
    expect(absentFromPillars(pillars)).toEqual([])
    expect(resolveSecondary({ pillars, centreElement: 'fire' })).toBeNull()
  })

  it('excludes the centre element from the pick, keeping the rest of the absent list', () => {
    const pillars = fourPillars({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
    expect(absentFromPillars(pillars)).toEqual(['metal', 'water'])
    expect(resolveSecondary({ pillars, centreElement: 'metal' })).toEqual({
      element: 'water',
      source: 'saju-absent',
    })
  })

  it('is null when pillars are missing', () => {
    expect(absentFromPillars(null)).toEqual([])
    expect(resolveSecondary({ pillars: null, centreElement: 'fire' })).toBeNull()
  })
})

describe('computeTalisman secondary', () => {
  it('attaches saju-absent metal for 1988-03-15 and ignores consensus deficiency', () => {
    const charts = charts1988()
    const wood = computeTalisman({
      access: LIVE_ACCESS,
      charts,
      consensus: fakeConsensus({ wood: 20 }),
    })
    const water = computeTalisman({
      access: LIVE_ACCESS,
      charts,
      consensus: fakeConsensus({ water: 20 }),
    })
    expect(wood!.secondary).toEqual({ element: 'metal', source: 'saju-absent' })
    expect(wood!.absentElements).toEqual(['metal', 'water'])
    expect(water!.secondary).toEqual(wood!.secondary)
    expect(water!.absentElements).toEqual(wood!.absentElements)
  })

  it('is null when there is no 사주', () => {
    const result = computeTalisman({
      access: LIVE_ACCESS,
      charts: EMPTY_CHARTS,
      consensus: fakeConsensus({ earth: 7 }),
    })
    expect(result!.secondary).toBeNull()
    expect(result!.absentElements).toEqual([])
  })

  it('does not read the consensus deficiency vector as a natal absence', () => {
    const pillars = fourPillars({ date: '1984-02-10', time: '12:00', timezone: 'Asia/Seoul' })
    const result = computeTalisman({
      access: LIVE_ACCESS,
      charts: charts1988({
        saju: { eokbu: eokbu(pillars), tenGods: tenGods(pillars.day.stem, pillars), pillars },
      }),
      consensus: fakeConsensus({ water: 20, metal: 11 }),
    })
    expect(result!.absentElements).toEqual([])
    expect(result!.secondary).toBeNull()
    expect(result!.centre.element).toBe('fire')
  })
})
