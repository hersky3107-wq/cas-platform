import { describe, expect, it } from 'vitest'
import {
  MAGNITUDE_BOUND_PCT,
  aggregateMagnitude,
  computeActualMagnitudePct,
  formatSignedPercent,
  magnitudeBoundForHorizon,
  roundMagnitude,
  validateMagnitude,
} from '../magnitude'

describe('magnitudeBoundForHorizon', () => {
  it('matches the chosen per-horizon table', () => {
    expect(MAGNITUDE_BOUND_PCT).toEqual({ '1d': 30, '1w': 60, '1m': 120, '3m': 250 })
    expect(magnitudeBoundForHorizon('1d')).toBe(30)
    expect(magnitudeBoundForHorizon('1w')).toBe(60)
    expect(magnitudeBoundForHorizon('1m')).toBe(120)
    expect(magnitudeBoundForHorizon('3m')).toBe(250)
  })

  it('falls back to the 1d bound for an unrecognized horizon rather than throwing', () => {
    expect(magnitudeBoundForHorizon('bogus')).toBe(30)
  })
})

describe('validateMagnitude', () => {
  it('requires a magnitude — null is invalid, same as missing direction', () => {
    expect(validateMagnitude('up', null, '1d')).toEqual({ ok: false, reason: 'missing' })
  })

  it('rejects non-numeric values (NaN / Infinity)', () => {
    expect(validateMagnitude('up', NaN, '1d')).toEqual({ ok: false, reason: 'non_numeric' })
    expect(validateMagnitude('up', Infinity, '1d')).toEqual({ ok: false, reason: 'non_numeric' })
    expect(validateMagnitude('down', -Infinity, '1d')).toEqual({ ok: false, reason: 'non_numeric' })
  })

  it('rejects a magnitude whose sign contradicts its own direction', () => {
    expect(validateMagnitude('up', -2.4, '1d')).toEqual({ ok: false, reason: 'sign_mismatch' })
    expect(validateMagnitude('down', 2.4, '1d')).toEqual({ ok: false, reason: 'sign_mismatch' })
  })

  it('accepts exactly zero for either direction', () => {
    expect(validateMagnitude('up', 0, '1d')).toEqual({ ok: true, value: 0 })
    expect(validateMagnitude('down', 0, '1d')).toEqual({ ok: true, value: 0 })
  })

  it('rejects an absurd value for the horizon (the +900% on a 1d equity round case)', () => {
    expect(validateMagnitude('up', 900, '1d')).toEqual({ ok: false, reason: 'out_of_bounds' })
  })

  it('accepts exactly the bound and rejects one unit past it', () => {
    expect(validateMagnitude('up', 30, '1d')).toEqual({ ok: true, value: 30 })
    expect(validateMagnitude('up', 30.01, '1d')).toEqual({ ok: false, reason: 'out_of_bounds' })
    expect(validateMagnitude('down', -60, '1w')).toEqual({ ok: true, value: -60 })
    expect(validateMagnitude('down', -60.01, '1w')).toEqual({ ok: false, reason: 'out_of_bounds' })
  })

  it('rounds an accepted value to two decimal places', () => {
    expect(validateMagnitude('up', 2.4444, '1d')).toEqual({ ok: true, value: 2.44 })
  })
})

describe('roundMagnitude', () => {
  it('rounds to two decimals', () => {
    expect(roundMagnitude(2.4444)).toBe(2.44)
    expect(roundMagnitude(-1.005)).toBeCloseTo(-1, 1)
  })
})

describe('formatSignedPercent', () => {
  it('always carries an explicit sign', () => {
    expect(formatSignedPercent(2.4)).toBe('+2.4%')
    expect(formatSignedPercent(-1.1)).toBe('-1.1%')
    expect(formatSignedPercent(0)).toBe('+0.0%')
  })

  it('respects the decimals argument', () => {
    expect(formatSignedPercent(2.449, 1)).toBe('+2.4%')
    expect(formatSignedPercent(-0.001, 1)).toBe('+0.0%')
  })
})

describe('aggregateMagnitude', () => {
  it('returns null/0 when there is no aggregate direction', () => {
    expect(aggregateMagnitude([{ direction: 'up', magnitude: 3 }], null)).toEqual({ medianPct: null, n: 0 })
  })

  it('aggregates ONLY across models that agree with the aggregate direction', () => {
    const models = [
      { direction: 'up', magnitude: 3 },
      { direction: 'up', magnitude: 5 },
      { direction: 'down', magnitude: -3 },
    ]
    // A naive mean across all three would drop toward ~1.7; the up-agreeing
    // median must ignore the down-call entirely.
    expect(aggregateMagnitude(models, 'up')).toEqual({ medianPct: 4, n: 2 })
  })

  it('never lets an opposite-direction outlier cancel the aggregate toward 0', () => {
    const models = [
      { direction: 'up', magnitude: 3 },
      { direction: 'down', magnitude: -3 },
    ]
    const up = aggregateMagnitude(models, 'up')
    expect(up.medianPct).toBe(3)
    expect(up.medianPct).not.toBe(0)
  })

  it('uses the median (odd and even counts), not a mean, so it is robust to a single extreme value', () => {
    const odd = [
      { direction: 'up', magnitude: 1 },
      { direction: 'up', magnitude: 2 },
      { direction: 'up', magnitude: 100 },
    ]
    // Mean would be ~34.3; the median stays anchored near the bulk of the calls.
    expect(aggregateMagnitude(odd, 'up').medianPct).toBe(2)

    const even = [
      { direction: 'up', magnitude: 2 },
      { direction: 'up', magnitude: 4 },
    ]
    expect(aggregateMagnitude(even, 'up').medianPct).toBe(3)
  })

  it('excludes direction-agreeing models with a null/non-numeric magnitude from the sample', () => {
    const models = [
      { direction: 'up', magnitude: 4 },
      { direction: 'up', magnitude: null },
      { direction: 'down', magnitude: -9 },
    ]
    expect(aggregateMagnitude(models, 'up')).toEqual({ medianPct: 4, n: 1 })
  })

  it('is null when no direction-agreeing model has a usable magnitude', () => {
    const models = [
      { direction: 'up', magnitude: null },
      { direction: 'down', magnitude: -3 },
    ]
    expect(aggregateMagnitude(models, 'up')).toEqual({ medianPct: null, n: 0 })
  })
})

describe('computeActualMagnitudePct', () => {
  it('computes signed percent change from anchor to resolution price', () => {
    expect(computeActualMagnitudePct(100, 101.4)).toBe(1.4)
    expect(computeActualMagnitudePct(100, 98.6)).toBe(-1.4)
  })

  it('is null until both prices exist', () => {
    expect(computeActualMagnitudePct(null, 101)).toBeNull()
    expect(computeActualMagnitudePct(100, null)).toBeNull()
    expect(computeActualMagnitudePct(null, null)).toBeNull()
  })

  it('is null for a non-finite or zero anchor (division-by-zero guard)', () => {
    expect(computeActualMagnitudePct(0, 101)).toBeNull()
    expect(computeActualMagnitudePct(NaN, 101)).toBeNull()
    expect(computeActualMagnitudePct(100, NaN)).toBeNull()
  })
})
