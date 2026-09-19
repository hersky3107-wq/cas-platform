import { describe, expect, it } from 'vitest'
import { HOLD_CENSUS_N, runHoldCensus } from '../hold-census'

describe('hold → 결번 census', () => {
  it(`counts voters over ${HOLD_CENSUS_N} varied rounds`, () => {
    const c = runHoldCensus()
    expect(c.n).toBe(HOLD_CENSUS_N)
    expect(c.up + c.down).toBe(HOLD_CENSUS_N)
    expect(c.voted1 + c.voted2 + c.voted3 + c.voted4).toBe(HOLD_CENSUS_N)
    expect(c.ichingAlone).toBe(c.voted1)
    // PRODUCT participation: 1.000 only when all four seats voted and agreed
    expect(c.confidence1).toBe(c.fourVotedAndAgree)
    expect(c.confidence1).toBeLessThan(c.allVotersAgree)
    expect(c.confidence1ByVoted[1]).toBe(0)
    expect(c.confidence1ByVoted[2]).toBe(0)
    expect(c.confidence1ByVoted[3]).toBe(0)
    expect(c.confidenceSum / c.n).toBeGreaterThan(0)
    expect(c.confidenceSum / c.n).toBeLessThan(1)
    expect(c.tarotHold / c.n).toBeGreaterThan(0.25)
    expect(c.runeHold / c.n).toBeGreaterThan(0.25)
    // 일진 decides; 월건 no longer vetoes. 오행 상생상극 has no leftover, so
    // 택일 결번 should be rare (zero under the current 5-relation table).
    expect(c.taeilHold / c.n).toBeLessThan(0.05)
    expect(c.drawSplit).toBeGreaterThan(0)
  })
})
