/**
 * PRISM native pair sketch — the concordance-based two-person entry point.
 * It must never require MBTI or colours (Person B has neither) and must be
 * deterministic from the two birth dates + atDate alone.
 */
import { describe, expect, it } from 'vitest'
import { birthAnchorVector, PrismInputError, prismPairSketch } from '../index'

const AT = '2026-09-07'

describe('birthAnchorVector', () => {
  it('is deterministic and axis-complete', () => {
    const a = birthAnchorVector('1988-11-23')
    const b = birthAnchorVector('1988-11-23')
    expect(a).toEqual(b)
    for (const value of Object.values(a)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(100)
    }
  })

  it('rejects a fake civil day', () => {
    expect(() => birthAnchorVector('1988-02-30')).toThrow(PrismInputError)
  })
})

describe('prismPairSketch', () => {
  it('reads a pair from two birth dates alone — no MBTI, no colours', () => {
    const sketch = prismPairSketch({ birthDateA: '1988-11-23', birthDateB: '1991-03-08', atDate: AT })
    expect(sketch.anchorConcordance).toBeGreaterThanOrEqual(0)
    expect(sketch.anchorConcordance).toBeLessThanOrEqual(100)
    expect(sketch.a.seasonElement).toBeTypeOf('string')
    expect(sketch.b.seasonElement).toBeTypeOf('string')
    expect(typeof sketch.sameAnnualCycle).toBe('boolean')
  })

  it('the same birth date on both sides is full concordance and RESONANCE', () => {
    const sketch = prismPairSketch({ birthDateA: '1988-11-23', birthDateB: '1988-11-23', atDate: AT })
    expect(sketch.anchorConcordance).toBe(100)
    expect(sketch.relationForA).toBe('RESONANCE')
    expect(sketch.relationForB).toBe('RESONANCE')
    expect(sketch.sameAnnualCycle).toBe(true)
  })

  it('element relations are directionally consistent (water feeds wood)', () => {
    // Deep winter (WATER) vs mid-spring (WOOD) — both clear of the 18-day
    // 土用 EARTH windows around the season boundaries.
    const sketch = prismPairSketch({ birthDateA: '1990-01-10', birthDateB: '1990-03-15', atDate: AT })
    expect(sketch.a.seasonElement).toBe('WATER')
    expect(sketch.b.seasonElement).toBe('WOOD')
    // A(water) generates B(wood): A pours out (OUTPUT), B is fed (SUPPORT).
    expect(sketch.relationForA).toBe('OUTPUT')
    expect(sketch.relationForB).toBe('SUPPORT')
  })

  it('is symmetric under swapping the two people', () => {
    const ab = prismPairSketch({ birthDateA: '1988-11-23', birthDateB: '1991-03-08', atDate: AT })
    const ba = prismPairSketch({ birthDateA: '1991-03-08', birthDateB: '1988-11-23', atDate: AT })
    expect(ab.anchorConcordance).toBe(ba.anchorConcordance)
    expect(ab.relationForA).toBe(ba.relationForB)
    expect(ab.relationForB).toBe(ba.relationForA)
    expect(ab.sameAnnualCycle).toBe(ba.sameAnnualCycle)
  })

  it('rejects fake civil days on either side', () => {
    expect(() =>
      prismPairSketch({ birthDateA: '1988-11-31', birthDateB: '1991-03-08', atDate: AT }),
    ).toThrow(PrismInputError)
    expect(() =>
      prismPairSketch({ birthDateA: '1988-11-23', birthDateB: '1991-02-30', atDate: AT }),
    ).toThrow(PrismInputError)
  })
})
