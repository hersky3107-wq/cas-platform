import { describe, expect, it } from 'vitest'
import {
  LOGIT_CLAMP_HI,
  LOGIT_CLAMP_LO,
  clampUnitProbability,
  dualConsensus,
  logOddsConsensus,
  majorityConsensus,
} from '../log-odds-consensus'

describe('clampUnitProbability', () => {
  it(`clamps to [${LOGIT_CLAMP_LO}, ${LOGIT_CLAMP_HI}] (0.5% / 99.5%)`, () => {
    expect(clampUnitProbability(0)).toBe(LOGIT_CLAMP_LO)
    expect(clampUnitProbability(1)).toBe(LOGIT_CLAMP_HI)
    expect(clampUnitProbability(0.5)).toBe(0.5)
  })
})

describe('majorityConsensus', () => {
  it('returns the count winner and mean stated probability', () => {
    const m = majorityConsensus([
      { direction: 'up', probability: 60 },
      { direction: 'up', probability: 70 },
      { direction: 'down', probability: 55 },
    ])
    expect(m).toEqual({ direction: 'up', probability: 61.7, up: 2, down: 1 })
  })

  it('ties to null direction', () => {
    const m = majorityConsensus([
      { direction: 'up', probability: 60 },
      { direction: 'down', probability: 60 },
    ])
    expect(m.direction).toBeNull()
    expect(m.up).toBe(1)
    expect(m.down).toBe(1)
  })
})

describe('logOddsConsensus', () => {
  it('matches a unanimous up call near the stated confidence', () => {
    const a = logOddsConsensus([
      { direction: 'up', probability: 70 },
      { direction: 'up', probability: 70 },
    ])
    expect(a.direction).toBe('up')
    expect(a.probability).toBe(70)
  })

  it('weights higher-confidence calls more than majority count alone', () => {
    // 2 weak ups vs 1 strong down — majority = up; log-odds can flip to down.
    const dual = dualConsensus([
      { direction: 'up', probability: 51 },
      { direction: 'up', probability: 51 },
      { direction: 'down', probability: 90 },
    ])
    expect(dual.majority.direction).toBe('up')
    expect(dual.aggregate.direction).toBe('down')
    expect(dual.aggregate.probability).toBeGreaterThan(50)
  })

  it('handles p=0 and p=100 via clamp without throwing', () => {
    const a = logOddsConsensus([
      { direction: 'up', probability: 100 },
      { direction: 'down', probability: 0 },
    ])
    expect(a.direction).toBe('up')
    expect(a.probability).not.toBeNull()
    expect(Number.isFinite(a.probability!)).toBe(true)
  })
})
