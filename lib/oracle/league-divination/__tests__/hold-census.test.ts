import { describe, expect, it } from 'vitest'
import { HOLD_CENSUS_N, runHoldCensus } from '../hold-census'

describe('hold → 결번 census', () => {
  it(`counts voters over ${HOLD_CENSUS_N} varied rounds`, () => {
    const c = runHoldCensus()
    expect(c.n).toBe(HOLD_CENSUS_N)
    expect(c.up + c.down).toBe(HOLD_CENSUS_N)
    expect(c.voted1 + c.voted2 + c.voted3 + c.voted4).toBe(HOLD_CENSUS_N)
    expect(c.ichingAlone).toBe(c.voted1)
    expect(c.confidence1).toBe(c.allVotersAgree)
    expect(c.fourVotedAndAgree).toBeLessThan(c.allVotersAgree)
    expect(c.tarotHold / c.n).toBeGreaterThan(0.25)
    expect(c.runeHold / c.n).toBeGreaterThan(0.25)
    expect(c.taeilHold / c.n).toBeGreaterThan(0)
    expect(c.taeilHold / c.n).toBeLessThan(0.5)
  })
})
