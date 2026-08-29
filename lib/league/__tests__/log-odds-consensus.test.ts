import { describe, expect, it } from 'vitest'
import {
  LOGIT_CLAMP_HI,
  LOGIT_CLAMP_LO,
  binaryCallsFromModels,
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

// ─────────────────────────────────────────────────────────────────────────────
// SIDE-TOKEN GENERALIZATION (2026-08-29) — frozen-fixture parity.
//
// The consensus vocabulary generalized from hardcoded 'up'/'down' to the
// round's contract side pair (default: up/down, so every existing call site
// is untouched). THE MATH MUST NOT MOVE. The two FROZEN functions below are
// verbatim copies of the pre-generalization implementations; the parity
// tests assert deep equality against them across a fixture sweep.
// ─────────────────────────────────────────────────────────────────────────────

type FrozenCall = { direction: 'up' | 'down'; probability: number }

function frozenRound1(n: number): number {
  return Math.round(n * 10) / 10
}

/** FROZEN pre-generalization majorityConsensus (verbatim @ 042bf875). */
function frozenMajorityConsensus(calls: readonly FrozenCall[]) {
  let up = 0
  let down = 0
  let sumP = 0
  let nP = 0
  for (const c of calls) {
    if (c.direction === 'up') up += 1
    else down += 1
    if (Number.isFinite(c.probability)) {
      sumP += c.probability
      nP += 1
    }
  }
  const direction: 'up' | 'down' | null =
    up === 0 && down === 0 ? null : up === down ? null : up > down ? 'up' : 'down'
  return { direction, probability: nP ? frozenRound1(sumP / nP) : null, up, down }
}

/** FROZEN pre-generalization logOddsConsensus (verbatim @ 042bf875). */
function frozenLogOddsConsensus(calls: readonly FrozenCall[]) {
  let sumW = 0
  let sumWLogit = 0
  let n = 0
  for (const c of calls) {
    if (!Number.isFinite(c.probability)) continue
    const conf = clampUnitProbability(c.probability / 100)
    const pUp = c.direction === 'up' ? conf : 1 - conf
    const w = conf
    sumW += w
    sumWLogit += w * Math.log(clampUnitProbability(pUp) / (1 - clampUnitProbability(pUp)))
    n += 1
  }
  if (n === 0 || sumW <= 0) {
    return { direction: null as 'up' | 'down' | null, probability: null as number | null, pUp: null as number | null, n: 0 }
  }
  const x = sumWLogit / sumW
  const pUp = x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x))
  const direction: 'up' | 'down' = pUp >= 0.5 ? 'up' : 'down'
  const probability = frozenRound1(100 * (direction === 'up' ? pUp : 1 - pUp))
  return { direction, probability, pUp, n }
}

/** Deterministic sweep: unanimous, split, tie, extremes, weighted flips, singletons, empty. */
const PARITY_FIXTURES: readonly (readonly FrozenCall[])[] = [
  [],
  [{ direction: 'up', probability: 55 }],
  [{ direction: 'down', probability: 88 }],
  [
    { direction: 'up', probability: 60 },
    { direction: 'up', probability: 70 },
    { direction: 'down', probability: 55 },
  ],
  [
    { direction: 'up', probability: 60 },
    { direction: 'down', probability: 60 },
  ],
  [
    { direction: 'up', probability: 51 },
    { direction: 'up', probability: 51 },
    { direction: 'down', probability: 90 },
  ],
  [
    { direction: 'up', probability: 100 },
    { direction: 'down', probability: 0 },
  ],
  [
    { direction: 'down', probability: 72.4 },
    { direction: 'down', probability: 66.6 },
    { direction: 'up', probability: 50 },
    { direction: 'up', probability: 97 },
    { direction: 'down', probability: 12 },
  ],
]

describe('side-token generalization — default (up/down) path is byte-identical', () => {
  it('majorityConsensus matches the frozen implementation across the sweep', () => {
    for (const calls of PARITY_FIXTURES) {
      expect(majorityConsensus(calls)).toEqual(frozenMajorityConsensus(calls))
    }
  })

  it('logOddsConsensus matches the frozen implementation across the sweep', () => {
    for (const calls of PARITY_FIXTURES) {
      expect(logOddsConsensus(calls)).toEqual(frozenLogOddsConsensus(calls))
    }
  })

  it('dualConsensus matches both frozen methods across the sweep', () => {
    for (const calls of PARITY_FIXTURES) {
      expect(dualConsensus(calls)).toEqual({
        majority: frozenMajorityConsensus(calls),
        aggregate: frozenLogOddsConsensus(calls),
      })
    }
  })
})

describe('side-token generalization — only the vocabulary moves', () => {
  const YES_NO = ['yes', 'no'] as const

  function mapped(calls: readonly FrozenCall[]) {
    return calls.map((c) => ({ direction: c.direction === 'up' ? ('yes' as const) : ('no' as const), probability: c.probability }))
  }

  it('yes/no consensus is the up/down consensus with tokens renamed — identical numbers', () => {
    for (const calls of PARITY_FIXTURES) {
      const base = dualConsensus(calls)
      const generalized = dualConsensus(mapped(calls), YES_NO)
      const rename = (d: string | null) => (d === 'up' ? 'yes' : d === 'down' ? 'no' : null)
      expect(generalized.majority).toEqual({ ...base.majority, direction: rename(base.majority.direction) })
      expect(generalized.aggregate).toEqual({ ...base.aggregate, direction: rename(base.aggregate.direction) })
    }
  })

  it('binaryCallsFromModels filters by the given side pair and drops everything else', () => {
    const models = [
      { direction: 'yes', probability: 70 },
      { direction: 'no', probability: 60 },
      { direction: 'up', probability: 80 },
      { direction: 'flat', probability: 50 },
      { direction: null, probability: 90 },
      { direction: 'yes', probability: Number.NaN },
    ]
    expect(binaryCallsFromModels(models, YES_NO)).toEqual([
      { direction: 'yes', probability: 70 },
      { direction: 'no', probability: 60 },
    ])
    // Default pair unchanged: only up/down pass, exactly as before.
    expect(binaryCallsFromModels(models)).toEqual([{ direction: 'up', probability: 80 }])
  })
})
