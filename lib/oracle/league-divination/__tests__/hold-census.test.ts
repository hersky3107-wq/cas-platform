import { describe, expect, it } from 'vitest'
import { HOLD_CENSUS_N, runHoldCensus } from '../hold-census'

describe('hold-collapse census', () => {
  it(`counts pre-collapse holds over ${HOLD_CENSUS_N} varied rounds`, () => {
    const c = runHoldCensus()
    expect(c.n).toBe(HOLD_CENSUS_N)
    expect(c.up + c.down).toBe(HOLD_CENSUS_N)
    // confidence 1.000 is exactly four ballots on the same side (3+2+2+2).
    expect(c.confidence1).toBe(c.allFourIdentical)
    // 타로/룬 hold is common: reversal does not flip `hold`, and many table
    // rows are hold. 택일 hold is the 일진/월건 split — needs moving clocks.
    expect(c.tarotHold / c.n).toBeGreaterThan(0.25)
    expect(c.runeHold / c.n).toBeGreaterThan(0.25)
    expect(c.taeilHold / c.n).toBeGreaterThan(0)
    expect(c.taeilHold / c.n).toBeLessThan(0.5)
  })
})
