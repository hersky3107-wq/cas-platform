import { describe, expect, it } from 'vitest'
import { eokbu, fourPillars } from '../../engines/calendar'
import { pickDeficiencyLeader, resolveCentre } from '../centre'
import { fakeConsensus } from './fixture'

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
    expect(centre).toEqual({ source: 'eokbu', mode: 'fill', element: 'fire', strength: 'weak' })
  })

  it('신강 억부 용신 → drain (hollow core)', () => {
    const p = fourPillars({ date: '1984-02-10', time: '12:00', timezone: 'Asia/Seoul' })
    const centre = resolveCentre({ eokbu: eokbu(p), deficiency: fakeConsensus({ metal: 20 }).elements.deficiency })
    expect(centre).toEqual({ source: 'eokbu', mode: 'drain', element: 'fire', strength: 'strong' })
  })

  it('중화 yongsin null → consensus deficiency argmax', () => {
    const p = fourPillars({ date: '1984-02-15', time: '12:00', timezone: 'Asia/Seoul' })
    expect(eokbu(p).yongsin).toBeNull()
    const centre = resolveCentre({ eokbu: eokbu(p), deficiency: fakeConsensus({ metal: 11, wood: 3 }).elements.deficiency })
    expect(centre).toEqual({ source: 'consensus', mode: 'fill', element: 'metal' })
  })

  it('종격 yongsin null → consensus deficiency argmax', () => {
    const p = fourPillars({ date: '1984-02-10', time: '04:30', timezone: 'Asia/Seoul' })
    expect(eokbu(p).yongsin).toBeNull()
    const centre = resolveCentre({ eokbu: eokbu(p), deficiency: fakeConsensus({ water: 9 }).elements.deficiency })
    expect(centre).toEqual({ source: 'consensus', mode: 'fill', element: 'water' })
  })
})
