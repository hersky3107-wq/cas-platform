import { describe, expect, it } from 'vitest'
import { computeConsensus, syntheticVote } from '../consensus'
import { ELEMENT_BASELINE } from '../conventions'
import { normalizeElements, normalizePhase } from '../math'
import type { ElementVector, PhaseVector, TraitVector } from '../types'

const FLAT_TRAITS: TraitVector = {
  drive: 50,
  stability: 50,
  relation: 50,
  control: 50,
  exploration: 50,
  reflection: 50,
}

const BALANCED_ELEMENTS = normalizeElements({ wood: 1, fire: 1, earth: 1, metal: 1, water: 1 })!

function phase(advance: number, hold: number, release: number): PhaseVector {
  return normalizePhase({ advance, hold, release })!
}

describe('computeConsensus', () => {
  it('three identical votes → consensus and ~0 spread', () => {
    const vote = syntheticVote('saju', {
      traits: FLAT_TRAITS,
      elements: BALANCED_ELEMENTS,
      phase: phase(80, 15, 5),
    })
    const result = computeConsensus([
      vote,
      { ...vote, system: 'astro' },
      { ...vote, system: 'prism' },
    ])

    expect(result.phase.verdict).toBe('consensus')
    expect(result.phase.leader).toBe('advance')
    expect(result.phase.tally.advance).toBeGreaterThanOrEqual(60)
    expect(result.traits.spread.drive).toBe(0)
    expect(result.traits.contested).toEqual([])
    expect(result.systemCount).toEqual({ total: 3, participating: 3, partial: 0, unreadable: 0 })
  })

  it('two opposite phase votes → clash with the pair listed', () => {
    const advancing = syntheticVote('saju', { phase: phase(80, 10, 10) })
    const releasing = syntheticVote('astro', { phase: phase(10, 10, 80) })
    const result = computeConsensus([advancing, releasing])

    expect(result.phase.verdict).toBe('clash')
    expect(result.phase.oppositions).toHaveLength(1)
    expect(result.phase.oppositions[0]).toMatchObject({ a: 'saju', b: 'astro' })
    expect(result.phase.oppositions[0]!.gap).toBeGreaterThanOrEqual(60)
  })

  it('clash beats a 60% majority', () => {
    const result = computeConsensus([
      syntheticVote('saju', { phase: phase(80, 15, 5) }),
      syntheticVote('astro', { phase: phase(10, 10, 80) }),
      syntheticVote('prism', { phase: phase(90, 5, 5) }),
      syntheticVote('ziwei', { phase: phase(85, 10, 5) }),
    ])

    expect(result.phase.tally.advance).toBeGreaterThanOrEqual(60)
    expect(result.phase.verdict).toBe('clash')
    expect(result.phase.oppositions.some((row) => row.a === 'saju' && row.b === 'astro')).toBe(true)
  })

  it('deficiency is 0 at or above 20, positive below', () => {
    const elements: ElementVector = { wood: 40, fire: 20, earth: 20, metal: 15, water: 5 }
    const result = computeConsensus([syntheticVote('saju', { elements })])
    expect(result.elements.deficiency.wood).toBe(0)
    expect(result.elements.deficiency.fire).toBe(0)
    expect(result.elements.deficiency.earth).toBe(0)
    expect(result.elements.deficiency.metal).toBe(5)
    expect(result.elements.deficiency.water).toBe(15)
    expect(result.elements.excess.wood).toBe(20)
    expect(ELEMENT_BASELINE).toBe(20)
  })

  it('a degraded vote weighs 0.5 and is marked, not dropped', () => {
    const full = syntheticVote('saju', {
      traits: { ...FLAT_TRAITS, drive: 80 },
      traitsWeight: 1,
      traitsBasis: 'direct',
    })
    const degraded = syntheticVote('astro', {
      traits: { ...FLAT_TRAITS, drive: 20 },
      traitsWeight: 0.5,
      traitsBasis: 'degraded',
    })
    const result = computeConsensus([full, degraded])

    expect(result.traits.participating).toEqual(['saju', 'astro'])
    expect(result.traits.unreadable).toEqual([])
    expect(degraded.confidence.traits).toEqual({ weight: 0.5, basis: 'degraded' })
    // (80*1 + 20*0.5) / 1.5 = 60
    expect(result.traits.mean.drive).toBe(60)
  })

  it('same shape at different absolute levels is NOT contested (centering regression guard)', () => {
    // All three votes share the exact same relative offsets across axes
    // (+10 drive, -10 stability, +5 relation, +15 control, -15 exploration,
    // -5 reflection from their own mean) but sit at different absolute
    // levels (30 / 50 / 70) — the prism-vs-saju/astro scale mismatch this
    // amendment exists to fix. None of the 6 axes should be contested.
    const shape = { drive: 10, stability: -10, relation: 5, control: 15, exploration: -15, reflection: -5 }
    const atLevel = (level: number): TraitVector => ({
      drive: level + shape.drive,
      stability: level + shape.stability,
      relation: level + shape.relation,
      control: level + shape.control,
      exploration: level + shape.exploration,
      reflection: level + shape.reflection,
    })

    const result = computeConsensus([
      syntheticVote('saju', { traits: atLevel(30) }),
      syntheticVote('astro', { traits: atLevel(50) }),
      syntheticVote('prism', { traits: atLevel(70) }),
    ])

    expect(result.traits.contested).toEqual([])
    for (const axis of Object.keys(shape) as (keyof typeof shape)[]) {
      expect(result.traits.spread[axis]).toBeLessThan(1)
      expect(result.traits.profile[axis]).toBeCloseTo(shape[axis], 1)
    }
    // Raw mean still reflects the absolute levels (unchanged behaviour).
    expect(result.traits.mean.drive).toBeCloseTo(60, 1) // (40+60+80)/3
  })

  it('a 45-59% leader is a `lean`, not `split` or `consensus`', () => {
    // hold 53.3 vs advance 32.4 vs release 14.3 — the shape of the
    // 7-projector worked example that motivated adding this band: a
    // clear lean that the old binary consensus/split verdict would have
    // mislabelled as `split`.
    const result = computeConsensus([
      syntheticVote('saju', { phase: phase(32.4, 53.3, 14.3) }),
      syntheticVote('astro', { phase: phase(32.4, 53.3, 14.3) }),
      syntheticVote('prism', { phase: phase(32.4, 53.3, 14.3) }),
    ])

    expect(result.phase.leader).toBe('hold')
    expect(result.phase.tally.hold).toBeGreaterThanOrEqual(45)
    expect(result.phase.tally.hold).toBeLessThan(60)
    expect(result.phase.verdict).toBe('lean')
  })

  it('a leader under 45% is `split`', () => {
    const result = computeConsensus([
      syntheticVote('saju', { phase: phase(40, 35, 25) }),
      syntheticVote('astro', { phase: phase(30, 40, 30) }),
      syntheticVote('prism', { phase: phase(35, 30, 35) }),
    ])

    expect(result.phase.tally[result.phase.leader]).toBeLessThan(45)
    expect(result.phase.verdict).toBe('split')
  })

  it('a >=60% leader is still `consensus`, unchanged by the new band', () => {
    const result = computeConsensus([
      syntheticVote('saju', { phase: phase(70, 20, 10) }),
      syntheticVote('astro', { phase: phase(65, 25, 10) }),
    ])

    expect(result.phase.tally.advance).toBeGreaterThanOrEqual(60)
    expect(result.phase.verdict).toBe('consensus')
  })

  it('clash still overrides a `lean`-range leader', () => {
    const result = computeConsensus([
      syntheticVote('saju', { phase: phase(35, 50, 15) }),
      syntheticVote('astro', { phase: phase(80, 10, 10) }),
      syntheticVote('prism', { phase: phase(10, 10, 80) }),
    ])

    expect(result.phase.verdict).toBe('clash')
  })

  it('unreadable systems appear in unreadable, never in participating', () => {
    const readable = syntheticVote('saju', { traits: FLAT_TRAITS, elements: BALANCED_ELEMENTS, phase: phase(70, 20, 10) })
    const blank = syntheticVote('iching', {})
    const result = computeConsensus([readable, blank])

    expect(result.traits.participating).toEqual(['saju'])
    expect(result.traits.unreadable).toEqual(['iching'])
    expect(result.elements.participating).toEqual(['saju'])
    expect(result.elements.unreadable).toEqual(['iching'])
    expect(result.phase.participating).toEqual(['saju'])
    expect(result.phase.unreadable).toEqual(['iching'])
    expect(result.traits.participating).not.toContain('iching')
    expect(result.systemCount.unreadable).toBe(1)
    expect(result.systemCount.participating).toBe(1)
  })
})
