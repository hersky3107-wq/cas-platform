import { describe, expect, it } from 'vitest'
import {
  ASPECT_ORBS,
  ASTRO_ENGINE_VERSION,
  natalChart,
  synastry,
  transits,
  type AstroBodyPosition,
} from '..'
import { __testing } from '../aspects'
import { normalizeDegrees } from '../math'

const JOBS_INPUT = {
  date: '1955-02-24',
  time: '19:15',
  tz: 'America/Los_Angeles',
  lat: 37.7749,
  lng: -122.4194,
  timeKnown: true,
} as const

const EXPECTED_JOBS = {
  Sun: 335.75,
  Moon: 7.75,
  Mercury: 314.3667,
  Venus: 291.1667,
  Mars: 29.0833,
  Jupiter: 110.5,
  Saturn: 231.1667,
  Uranus: 114.1333,
  Neptune: 208.05,
  Pluto: 145.3167,
  TrueNode: 273.4,
} as const

describe('Step-1 public reference chart', () => {
  it('matches published tropical planet longitudes within 0.1 degrees', () => {
    const chart = natalChart(JOBS_INPUT)
    for (const [name, expected] of Object.entries(EXPECTED_JOBS)) {
      expect(chart.bodies[name as keyof typeof chart.bodies].longitude).toBeCloseTo(expected, 1)
    }
    expect(chart.bodies.SouthNode.longitude).toBeCloseTo(
      normalizeDegrees(chart.bodies.TrueNode.longitude + 180),
      8,
    )
  })

  it('matches published Ascendant and MC within 0.5 degrees', () => {
    const chart = natalChart(JOBS_INPUT)
    expect(chart.angles).not.toBeNull()
    expect(chart.angles!.ascendant).toBeCloseTo(172.2833, 1)
    expect(chart.angles!.midheaven).toBeCloseTo(81.3167, 1)
  })

  it('matches all twelve published Placidus cusps within 0.1 degrees', () => {
    const chart = natalChart(JOBS_INPUT)
    const expected = [
      172.2833, 198.25, 228.35, 261.3167, 294.4667, 325.2167,
      352.2833, 18.25, 48.35, 81.3167, 114.4667, 145.2167,
    ]
    expect(chart.houseSystemUsed).toBe('PLACIDUS')
    expect(chart.houses).not.toBeNull()
    chart.houses!.forEach((cusp, index) => expect(cusp).toBeCloseTo(expected[index]!, 1))
  })
})

describe('houses and unknown time', () => {
  it('falls back to whole-sign houses above 66.5 degrees latitude with finite cusps', () => {
    const chart = natalChart({ ...JOBS_INPUT, lat: 70 })
    expect(chart.houseSystemUsed).toBe('WHOLE_SIGN')
    expect(chart.houses).toHaveLength(12)
    expect(chart.houses!.every(Number.isFinite)).toBe(true)
    expect(chart.houses!.every((cusp) => cusp % 30 === 0)).toBe(true)
  })

  it('has monotonically increasing cusps modulo 360', () => {
    const chart = natalChart(JOBS_INPUT)
    const cusps = chart.houses!
    for (let index = 0; index < 12; index++) {
      const next = cusps[(index + 1) % 12]!
      const forwardArc = normalizeDegrees(next - cusps[index]!)
      expect(forwardArc).toBeGreaterThan(0)
      expect(forwardArc).toBeLessThan(180)
    }
  })

  it('never guesses angles or houses when time is unknown', () => {
    const chart = natalChart({ ...JOBS_INPUT, time: null, timeKnown: false })
    expect(chart.angles).toBeNull()
    expect(chart.houses).toBeNull()
    expect(chart.limitations).toEqual(['no_houses', 'no_angles', 'moon_approximate'])
    expect(chart.bodies.Moon.uncertaintyDegrees).toBeGreaterThan(10)
    expect(Object.values(chart.bodies).every((body) => body.house === null)).toBe(true)
  })
})

describe('motion and aspects', () => {
  it('detects the documented Mercury retrograde in the reference chart', () => {
    const chart = natalChart(JOBS_INPUT)
    expect(chart.bodies.Mercury.retrograde).toBe(true)
    expect(chart.bodies.Mercury.speed).toBeLessThan(0)
  })

  function body(longitude: number, speed: number): AstroBodyPosition {
    return {
      longitude,
      sign: 'Aries',
      degreeInSign: longitude % 30,
      speed,
      retrograde: speed < 0,
      house: null,
    }
  }

  it('does not form an aspect at exactly orb + 0.01 degrees', () => {
    const result = __testing.matchAspect(
      'Sun',
      body(0, 1),
      'Moon',
      body(ASPECT_ORBS.conjunction + 0.01, 0),
    )
    expect(result).toBeNull()
  })

  it('marks a fast body approaching a slower one as applying', () => {
    const result = __testing.matchAspect('Mercury', body(10, 1.5), 'Saturn', body(17, 0.05))
    expect(result?.type).toBe('conjunction')
    expect(result?.applying).toBe(true)
  })

  it('marks a fast body moving away from a slower one as separating', () => {
    const result = __testing.matchAspect('Mercury', body(17, 1.5), 'Saturn', body(10, 0.05))
    expect(result?.type).toBe('conjunction')
    expect(result?.applying).toBe(false)
  })
})

describe('parallel products', () => {
  it('transits returns only transit-to-natal cross aspects', () => {
    const natal = natalChart(JOBS_INPUT)
    const result = transits({
      natal,
      at: { date: '2026-08-15', time: '12:00', tz: 'Asia/Seoul' },
    })
    expect(result.aspects.length).toBeGreaterThan(0)
    expect(result.aspects.every((aspect) => aspect.aSide === 'transit')).toBe(true)
    expect(result.aspects.every((aspect) => aspect.bSide === 'natal')).toBe(true)
    expect(Object.values(result.bodies).every((body) => body.house === null)).toBe(true)
  })

  it('synastry returns only A-to-B cross aspects', () => {
    const chartA = natalChart(JOBS_INPUT)
    const chartB = natalChart({
      date: '1961-08-04',
      time: null,
      tz: 'America/Los_Angeles',
      lat: 34.0522,
      lng: -118.2437,
      timeKnown: false,
    })
    const result = synastry({ chartA, chartB })
    expect(result.aspects.length).toBeGreaterThan(0)
    expect(result.aspects.every((aspect) => aspect.aSide === 'A' && aspect.bSide === 'B')).toBe(true)
  })
})

describe('versioning', () => {
  it('exports an explicit engine version', () => {
    expect(ASTRO_ENGINE_VERSION).toBe('1.0.0')
  })
})
