import { describe, expect, it } from 'vitest'
import { multiplicativeDevig, shinDevig, devigOutcomes } from '../devig'

/** Probed Pinnacle h2h, Arsenal vs Leeds, 2026-10-10, THE_ODDS_API eu. */
const PINNACLE_ARSENAL_LEEDS = [1.38, 7.65, 4.93] as const

describe('multiplicative devig', () => {
  it('normalizes raw implied prices onto the unit simplex', () => {
    const p = multiplicativeDevig(PINNACLE_ARSENAL_LEEDS)
    const sum = p.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 10)
    expect(p[0]).toBeCloseTo(0.6848, 3)
    expect(p[1]).toBeCloseTo(0.1235, 3)
    expect(p[2]).toBeCloseTo(0.1917, 3)
  })
})

describe('Shin devig', () => {
  it('raises the favorite vs multiplicative (longshot bias correction)', () => {
    const multi = multiplicativeDevig(PINNACLE_ARSENAL_LEEDS)
    const shin = shinDevig(PINNACLE_ARSENAL_LEEDS)
    expect(shin.probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8)
    expect(shin.z).toBeGreaterThan(0.02)
    expect(shin.z).toBeLessThan(0.04)
    expect(shin.probabilities[0]!).toBeGreaterThan(multi[0]!)
    expect(shin.probabilities[1]!).toBeLessThan(multi[1]!)
  })

  it('returns z=0 on a already-fair book', () => {
    const fair = shinDevig([2, 2])
    expect(fair.z).toBe(0)
    expect(fair.probabilities[0]).toBeCloseTo(0.5, 10)
  })
})

describe('devigOutcomes', () => {
  it('labels Arsenal/Leeds/Draw with Shin true probabilities', () => {
    const result = devigOutcomes(
      [
        { name: 'Arsenal', price: 1.38 },
        { name: 'Leeds United', price: 7.65 },
        { name: 'Draw', price: 4.93 },
      ],
      'shin'
    )
    expect(result.method).toBe('shin')
    expect(result.overroundPct).toBeCloseTo(5.82, 1)
    const arsenal = result.outcomes.find((o) => o.name === 'Arsenal')
    expect(arsenal?.probability).toBeCloseTo(0.7, 2)
  })
})
