import { describe, expect, it } from 'vitest'
import { eokbu, fourPillars, tenGods } from '../../engines/calendar'
import { pickDeficiencyLeader, resolveCentre } from '../centre'
import { computeTalisman } from '../compute'
import { charts1988, fakeConsensus, LIVE_ACCESS, EMPTY_CHARTS } from './fixture'

describe('pickDeficiencyLeader', () => {
  it('returns the argmax and breaks ties by ELEMENT_AXES order', () => {
    expect(pickDeficiencyLeader({ wood: 4, fire: 12, earth: 1, metal: 0, water: 0 })).toBe('fire')
    expect(pickDeficiencyLeader({ wood: 8, fire: 8, earth: 0, metal: 0, water: 0 })).toBe('wood')
    expect(pickDeficiencyLeader({ wood: 0, fire: 0, earth: 0, metal: 0, water: 0 })).toBeNull()
  })
})

describe('resolveCentre', () => {
  it('신약 억부 용신 → fill, source eokbu, ignores deficiency argmax', () => {
    const p = fourPillars({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
    const centre = resolveCentre({
      eokbu: eokbu(p),
      deficiency: fakeConsensus({ water: 20, fire: 1 }).elements.deficiency,
    })
    expect(centre).toEqual({ source: 'eokbu', mode: 'fill', element: 'fire', strength: 'weak', intensity: 'full' })
  })

  it('신강 억부 용신 → drain (hollow core)', () => {
    const p = fourPillars({ date: '1984-02-10', time: '12:00', timezone: 'Asia/Seoul' })
    const centre = resolveCentre({ eokbu: eokbu(p), deficiency: fakeConsensus({ metal: 20 }).elements.deficiency })
    expect(centre).toEqual({ source: 'eokbu', mode: 'drain', element: 'fire', strength: 'strong', intensity: 'full' })
  })

  it('중화 → 억부 경향, 득령 0 → soft fill, ignores deficiency', () => {
    const p = fourPillars({ date: '1984-02-15', time: '12:00', timezone: 'Asia/Seoul' })
    expect(eokbu(p).yongsin).toBeNull()
    const centre = resolveCentre({
      eokbu: eokbu(p),
      deficiency: fakeConsensus({ metal: 11, wood: 3 }).elements.deficiency,
      dayElement: p.day.stem.element,
    })
    expect(centre).toEqual({
      source: 'eokbu-lean',
      mode: 'fill',
      element: 'fire',
      strength: 'balanced',
      intensity: 'soft',
    })
  })

  it('종격 → follow the dominant element', () => {
    const p = fourPillars({ date: '1980-01-08', time: '04:30', timezone: 'Asia/Seoul' })
    expect(eokbu(p).yongsin).toBeNull()
    const centre = resolveCentre({ eokbu: eokbu(p), deficiency: fakeConsensus({ water: 9 }).elements.deficiency })
    expect(centre).toEqual({ source: 'jonggyeok', mode: 'follow', element: 'earth', intensity: 'full' })
  })

  it('falls back to consensus only when 사주 is missing', () => {
    const centre = resolveCentre({
      eokbu: null,
      deficiency: fakeConsensus({ metal: 11 }).elements.deficiency,
    })
    expect(centre).toEqual({ source: 'consensus', mode: 'fill', element: 'metal', intensity: 'full' })
  })
})

describe('computeTalisman centre paths from distinct 사주', () => {
  it('신약 / 신강 / 중화 / 종격 each produce a different centre path', () => {
    const weak = computeTalisman({
      access: LIVE_ACCESS,
      charts: charts1988(),
      consensus: fakeConsensus({ metal: 20 }),
    })
    expect(weak!.centre).toEqual({ source: 'eokbu', mode: 'fill', element: 'fire', strength: 'weak', intensity: 'full' })

    const strongPillars = fourPillars({ date: '1984-02-10', time: '12:00', timezone: 'Asia/Seoul' })
    const strong = computeTalisman({
      access: LIVE_ACCESS,
      charts: charts1988({
        saju: { eokbu: eokbu(strongPillars), tenGods: tenGods(strongPillars.day.stem, strongPillars), pillars: strongPillars },
      }),
      consensus: fakeConsensus({ water: 20 }),
    })
    expect(strong!.centre).toEqual({ source: 'eokbu', mode: 'drain', element: 'fire', strength: 'strong', intensity: 'full' })

    const balancedPillars = fourPillars({ date: '1984-02-15', time: '12:00', timezone: 'Asia/Seoul' })
    const balanced = computeTalisman({
      access: LIVE_ACCESS,
      charts: charts1988({
        saju: { eokbu: eokbu(balancedPillars), tenGods: tenGods(balancedPillars.day.stem, balancedPillars), pillars: balancedPillars },
      }),
      consensus: fakeConsensus({ metal: 11, wood: 3 }),
    })
    expect(balanced!.centre).toEqual({
      source: 'eokbu-lean',
      mode: 'fill',
      element: 'fire',
      strength: 'balanced',
      intensity: 'soft',
    })

    const jongPillars = fourPillars({ date: '1980-01-08', time: '04:30', timezone: 'Asia/Seoul' })
    const jong = computeTalisman({
      access: LIVE_ACCESS,
      charts: charts1988({
        saju: { eokbu: eokbu(jongPillars), tenGods: tenGods(jongPillars.day.stem, jongPillars), pillars: jongPillars },
      }),
      consensus: fakeConsensus({ water: 9 }),
    })
    expect(jong!.centre).toEqual({ source: 'jonggyeok', mode: 'follow', element: 'earth', intensity: 'full' })
  })

  it('EMPTY_CHARTS still falls back because pillars are missing', () => {
    const result = computeTalisman({
      access: LIVE_ACCESS,
      charts: EMPTY_CHARTS,
      consensus: fakeConsensus({ earth: 7 }),
    })
    expect(result?.centre).toEqual({ source: 'consensus', mode: 'fill', element: 'earth', intensity: 'full' })
  })
})
