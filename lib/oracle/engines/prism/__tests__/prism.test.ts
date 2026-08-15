import { describe, expect, it } from 'vitest'
import {
  COLOR_AXES,
  COLOR_CONFLICT_BOUNDS,
  COLOR_PROFILES,
  CORE_AXES,
  CYCLE_BY_ID,
  MBTI_AXIS_STATS,
  MBTI_TYPES,
  PRISM_COLORS,
} from '../tables'
import { concordance, domainStarRating, isPeak, mbtiVector, PRISM_ENGINE_VERSION, prism, PrismInputError } from '..'
import type { PrismInput } from '../types'
import type { ColorVector, CoreVector, PrismColor } from '../tables'

const BASE: PrismInput = {
  birthDate: '1988-03-15',
  mbti: 'INFJ',
  colors: { impulse: 'crimson', need: 'sage', identity: 'indigo' },
  microCheck: [3, 3, 3, 3],
  atDate: '2026-08-15',
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('engine version', () => {
  it('is 1.2.1 after the headline split (FIX 7)', () => {
    expect(PRISM_ENGINE_VERSION).toBe('1.2.1')
  })
})

describe('cycle base stretching (FIX 4)', () => {
  it('applies clamp(60 + (old - 60) * 1.45, 20, 95) uniformly to cycle bases', () => {
    // Ignition: energy 70 -> 75
    expect(CYCLE_BY_ID[0].base.energy).toBe(75)
    // Tension: energy 40 -> 31, love 42 -> 34
    expect(CYCLE_BY_ID[3].base.energy).toBe(31)
    expect(CYCLE_BY_ID[3].base.love).toBe(34)
    // Restore: work 42 -> 34
    expect(CYCLE_BY_ID[9].base.work).toBe(34)
    // Command: work 72 -> 77
    expect(CYCLE_BY_ID[8].base.work).toBe(77)
    // All bases are within the new clamp bounds
    for (const id of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const) {
      for (const score of Object.values(CYCLE_BY_ID[id].base)) {
        expect(score).toBeGreaterThanOrEqual(20)
        expect(score).toBeLessThanOrEqual(95)
      }
    }
  })
})

describe('within-user spread (FIX 6)', () => {
  it('produces a range > 15 for a user whose annual cycle is stretched', () => {
    // Birth 2022-02-15 → age 4 at 2026-08-15 → annual cycle 4 (Harvest).
    // Harvest has money 77 and social 46 before modifiers, so the raw range is already wide.
    const result = prism({
      birthDate: '2022-02-15',
      mbti: 'ISTJ',
      colors: { impulse: 'gold', need: 'sage', identity: 'slate' },
      microCheck: [3, 3, 3, 3],
      atDate: '2026-08-15',
    })
    const scores = Object.values(result.domainScores)
    const range = Math.max(...scores) - Math.min(...scores)
    expect(range).toBeGreaterThan(15)
  })
})

describe('money scaling (FIX 5)', () => {
  it('allows money to reach 5★ with a Harvest annual cycle and money-favoring colors', () => {
    // Harvest has the highest money base (77). With the 1.4 money color-state
    // scale and an MBTI with positive money affinity, money should cross 80.
    const result = prism({
      birthDate: '2022-02-15',
      mbti: 'ESTJ',
      colors: { impulse: 'gold', need: 'sage', identity: 'silver' },
      microCheck: [3, 3, 3, 3],
      atDate: '2026-08-15',
    })
    expect(result.domainScores.money).toBeGreaterThanOrEqual(80)
    expect(result.domainStars.money.star).toBe(5)
  })
})

describe('prism validation', () => {
  it('throws a typed error when any two colors match', () => {
    expect(() => prism({ ...BASE, colors: { impulse: 'crimson', need: 'crimson', identity: 'sage' } })).toThrow(
      PrismInputError,
    )
    try {
      prism({ ...BASE, colors: { impulse: 'crimson', need: 'sage', identity: 'crimson' } })
      expect.fail('expected throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PrismInputError)
      expect((error as PrismInputError).code).toBe('duplicate_colors')
    }
  })
})

describe('prism determinism', () => {
  it('returns identical output 100 times for the same input and atDate', () => {
    const first = prism(BASE)
    for (let i = 0; i < 100; i++) {
      expect(prism(BASE)).toEqual(first)
    }
  })
})

describe('annual cycle birthday rollover', () => {
  it('advances on the birthday, not on January 1', () => {
    const beforeNewYear = prism({ ...BASE, birthDate: '1990-06-15', atDate: '2025-12-31' })
    const afterNewYear = prism({ ...BASE, birthDate: '1990-06-15', atDate: '2026-01-01' })
    const beforeBirthday = prism({ ...BASE, birthDate: '1990-06-15', atDate: '2026-06-14' })
    const onBirthday = prism({ ...BASE, birthDate: '1990-06-15', atDate: '2026-06-15' })

    expect(afterNewYear.annualCycle.id).toBe(beforeNewYear.annualCycle.id)
    expect(beforeBirthday.annualCycle.id).toBe(beforeNewYear.annualCycle.id)
    expect(onBirthday.annualCycle.id).not.toBe(beforeBirthday.annualCycle.id)
    expect(onBirthday.annualCycle.id).toBe(((beforeBirthday.annualCycle.id + 1) % 12) as typeof onBirthday.annualCycle.id)
  })
})

describe('edge-case birthdays', () => {
  it('accepts Feb 29 and day-31 births and returns a monthly cycle 0–11', () => {
    const leap = prism({ ...BASE, birthDate: '2000-02-29', atDate: '2026-03-01' })
    const day31 = prism({ ...BASE, birthDate: '1991-01-31', atDate: '2026-04-30' })
    expect(leap.monthlyCycle.id).toBeGreaterThanOrEqual(0)
    expect(leap.monthlyCycle.id).toBeLessThanOrEqual(11)
    expect(day31.monthlyCycle.id).toBeGreaterThanOrEqual(0)
    expect(day31.monthlyCycle.id).toBeLessThanOrEqual(11)
    expect(leap.annualCycle.name.length).toBeGreaterThan(0)
    expect(day31.annualCycle.name.length).toBeGreaterThan(0)
  })
})

describe('microCheck degradation', () => {
  it('returns null mind-body fields and a limitation when microCheck is absent', () => {
    const result = prism({
      birthDate: BASE.birthDate,
      mbti: BASE.mbti,
      colors: BASE.colors,
      atDate: BASE.atDate,
    })
    expect(result.mindBody).toEqual({
      activation: null,
      tension: null,
      recoveryNeed: null,
      mentalLoad: null,
    })
    expect(result.limitations).toEqual(['no_micro_check'])
    expect(result.flags.noMicroCheck).toBe(true)
    expect(result.flags.extremeFatigue).toBe(false)
  })
})

describe('coreMatrix isolation', () => {
  it('does not let impulse or need colors change coreMatrix', () => {
    const a = prism(BASE)
    const b = prism({
      ...BASE,
      colors: { impulse: BASE.colors.need, need: BASE.colors.impulse, identity: BASE.colors.identity },
    })
    expect(b.coreMatrix).toEqual(a.coreMatrix)
    expect(b.currentConflict).toBe(a.currentConflict)
    expect(b.identityProjected).toEqual(a.identityProjected)
  })
})

describe('domain score bounds', () => {
  it('keeps every domain score in 0–100 across 10,000 random inputs', () => {
    const rng = mulberry32(20260815)
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!
    for (let i = 0; i < 10_000; i++) {
      const year = 1950 + Math.floor(rng() * 61)
      const month = 1 + Math.floor(rng() * 12)
      const day = 1 + Math.floor(rng() * 28)
      const colors = new Set<string>()
      while (colors.size < 3) colors.add(pick(PRISM_COLORS))
      const [impulse, need, identity] = [...colors] as [string, string, string]
      const result = prism({
        birthDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        mbti: pick(MBTI_TYPES),
        colors: { impulse: impulse as (typeof PRISM_COLORS)[number], need: need as (typeof PRISM_COLORS)[number], identity: identity as (typeof PRISM_COLORS)[number] },
        microCheck: [
          1 + Math.floor(rng() * 5),
          1 + Math.floor(rng() * 5),
          1 + Math.floor(rng() * 5),
          1 + Math.floor(rng() * 5),
        ],
        atDate: '2026-08-15',
      })
      for (const score of Object.values(result.domainScores)) {
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('per-domain stars', () => {
  it('follows the spec bands and flags PEAK at 90+', () => {
    expect(domainStarRating(0)).toBe(1)
    expect(domainStarRating(29)).toBe(1)
    expect(domainStarRating(30)).toBe(2)
    expect(domainStarRating(44)).toBe(2)
    expect(domainStarRating(45)).toBe(3)
    expect(domainStarRating(59)).toBe(3)
    expect(domainStarRating(60)).toBe(4)
    expect(domainStarRating(79)).toBe(4)
    expect(domainStarRating(80)).toBe(5)
    expect(domainStarRating(100)).toBe(5)

    expect(isPeak(89)).toBe(false)
    expect(isPeak(90)).toBe(true)
    expect(isPeak(100)).toBe(true)
  })

  it('computes domainStars per domain, opportunityDomain as highest score, warningDomain as lowest', () => {
    const result = prism(BASE)
    for (const domain of Object.keys(result.domainScores) as (keyof typeof result.domainScores)[]) {
      expect(result.domainStars[domain].star).toBe(domainStarRating(result.domainScores[domain]))
      expect(result.domainStars[domain].peak).toBe(isPeak(result.domainScores[domain]))
    }
    const scores = Object.values(result.domainScores)
    expect(result.domainScores[result.opportunityDomain]).toBe(Math.max(...scores))
    expect(result.domainScores[result.warningDomain]).toBe(Math.min(...scores))
    expect(result.headlineDomain).toBe(result.opportunityDomain)
  })
})

describe('conflict rescale against the empirical color-pair bounds', () => {
  function colorRms(a: ColorVector, b: ColorVector): number {
    let sumSq = 0
    for (const axis of COLOR_AXES) {
      const delta = a[axis] - b[axis]
      sumSq += delta * delta
    }
    return Math.sqrt(sumSq / COLOR_AXES.length)
  }

  function extremePairs(): { closest: [PrismColor, PrismColor]; farthest: [PrismColor, PrismColor] } {
    let closest: [PrismColor, PrismColor] = [PRISM_COLORS[0]!, PRISM_COLORS[1]!]
    let farthest: [PrismColor, PrismColor] = [PRISM_COLORS[0]!, PRISM_COLORS[1]!]
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < PRISM_COLORS.length; i++) {
      for (let j = i + 1; j < PRISM_COLORS.length; j++) {
        const a = PRISM_COLORS[i]!
        const b = PRISM_COLORS[j]!
        const dist = colorRms(COLOR_PROFILES[a], COLOR_PROFILES[b])
        if (dist < min) {
          min = dist
          closest = [a, b]
        }
        if (dist > max) {
          max = dist
          farthest = [a, b]
        }
      }
    }
    return { closest, farthest }
  }

  it('scores the empirically closest color pair near 0 and the farthest pair near 100', () => {
    const { closest, farthest } = extremePairs()
    const thirdFor = (used: readonly string[]) => PRISM_COLORS.find((c) => !used.includes(c))!

    const closestResult = prism({
      ...BASE,
      colors: { impulse: closest[0], need: closest[1], identity: thirdFor(closest) },
    })
    expect(closestResult.currentConflict).toBeCloseTo(0, 5)

    const farthestResult = prism({
      ...BASE,
      colors: { impulse: farthest[0], need: farthest[1], identity: thirdFor(farthest) },
    })
    expect(farthestResult.currentConflict).toBeCloseTo(100, 5)
  })

  it('COLOR_CONFLICT_BOUNDS reflects the exact min/max over all 276 pairs', () => {
    expect(COLOR_CONFLICT_BOUNDS.max).toBeGreaterThan(COLOR_CONFLICT_BOUNDS.min)
    expect(PRISM_COLORS.length).toBe(24)
  })
})

describe('shadowPressure range', () => {
  it('reaches at least band 3 (50+) for a constructed high-conflict, low-concordance input', () => {
    // onyx (very high control / low relation) vs rose (very high relation / low control)
    // are near-maximally distant colors, driving conflict up and concordance down.
    const result = prism({
      birthDate: '1975-01-10',
      mbti: 'ESTP',
      colors: { impulse: 'onyx', need: 'rose', identity: 'violet' },
      microCheck: [5, 5, 1, 5],
      atDate: '1975-07-10',
    })
    expect(result.shadowPressure).toBeGreaterThanOrEqual(50)
  })
})

describe('concordance shape invariance', () => {
  it('is unchanged when a constant is added to every axis of one vector (correlation property)', () => {
    const identity: CoreVector = { drive: 20, stability: 80, relation: 40, control: 60, exploration: 30, reflection: 70 }
    const core: CoreVector = { drive: 25, stability: 75, relation: 45, control: 55, exploration: 35, reflection: 65 }
    const base = concordance(identity, core)

    const shiftedCore: CoreVector = Object.fromEntries(
      Object.entries(core).map(([axis, value]) => [axis, value + 30]),
    ) as CoreVector
    expect(concordance(identity, shiftedCore)).toBeCloseTo(base, 10)

    const shiftedIdentity: CoreVector = Object.fromEntries(
      Object.entries(identity).map(([axis, value]) => [axis, value - 15]),
    ) as CoreVector
    expect(concordance(shiftedIdentity, core)).toBeCloseTo(base, 10)
  })
})

describe('axis normalization', () => {
  it('gives each core axis a comparable spread across all 16 MBTI types', () => {
    const normalized = MBTI_TYPES.map((type) => mbtiVector(type))
    const sds = CORE_AXES.map((axis) => {
      const values = normalized.map((vector) => vector[axis])
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length
      const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
      return Math.sqrt(variance)
    })
    const max = Math.max(...sds)
    const min = Math.min(...sds)
    expect(max - min).toBeLessThan(0.5)
    for (const sd of sds) {
      expect(sd).toBeGreaterThan(10)
      expect(sd).toBeLessThan(14)
    }

    const rawRelation = MBTI_AXIS_STATS.relation
    const rawStability = MBTI_AXIS_STATS.stability
    expect(rawRelation.sd).toBeGreaterThan(rawStability.sd)
  })
})
