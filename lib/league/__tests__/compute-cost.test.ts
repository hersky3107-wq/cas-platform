import { describe, expect, it } from 'vitest'
import {
  computeCostUsd,
  computeLegacyGrokListPriceUsd,
  lookupRosterEntry,
} from '../roster'

const grok = () => lookupRosterEntry('grok-4.6-livesearch')!

describe('computeCostUsd — grok tiered list price', () => {
  it('uses $2/$6 under 200k prompt tokens', () => {
    // 100k in × $2 + 2k out × $6 = $0.212
    expect(computeCostUsd(grok(), 100_000, 2_000)).toBeCloseTo(0.212, 6)
  })

  it('flips ALL tokens to $4/$12 at or above 200k prompt tokens', () => {
    // 200k in × $4 + 3k out × $12 = $0.836
    expect(computeCostUsd(grok(), 200_000, 3_000)).toBeCloseTo(0.836, 6)
  })

  it('does not use the old $3/$15 blended rate', () => {
    const under = computeCostUsd(grok(), 141_604, 2_407)
    const old = computeLegacyGrokListPriceUsd(141_604, 2_407)
    expect(old).toBeCloseTo((141_604 * 3 + 2_407 * 15) / 1e6, 6)
    expect(under).toBeLessThan(old)
    expect(under).toBeCloseTo((141_604 * 2 + 2_407 * 6) / 1e6, 6)
  })

  it('exposes max_turns: 3 on the livesearch caller', () => {
    const caller = grok().caller
    expect(caller.kind).toBe('core')
    if (caller.kind === 'core') expect(caller.maxTurns).toBe(3)
  })
})

describe('computeCostUsd — grok-4.3 published tiers', () => {
  const challenger = () => lookupRosterEntry('grok-4.3')!

  it('uses $1.25/$2.50 under 200k', () => {
    expect(computeCostUsd(challenger(), 100_000, 2_000)).toBeCloseTo(0.13, 6)
  })

  it('flips ALL tokens to $2.50/$5.00 at or above 200k', () => {
    expect(computeCostUsd(challenger(), 200_000, 2_000)).toBeCloseTo(0.51, 6)
  })
})
