import { describe, expect, it } from 'vitest'
import { PRISM_COLORS } from '../../engines/prism'
import { validateSessionInputs } from '../session-inputs'

describe('validateSessionInputs', () => {
  it('accepts distinct PRISM colors and a four-value micro check', () => {
    const result = validateSessionInputs({
      prism: {
        impulse: PRISM_COLORS[0],
        need: PRISM_COLORS[1],
        identity: PRISM_COLORS[2],
        microCheck: [1, 2, 3, 5],
      },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value?.prism?.microCheck).toEqual([1, 2, 3, 5])
    }
  })

  it('rejects duplicate colors', () => {
    const result = validateSessionInputs({
      prism: {
        impulse: PRISM_COLORS[0],
        need: PRISM_COLORS[0],
        identity: PRISM_COLORS[1],
      },
    })

    expect(result).toEqual({
      ok: false,
      error: 'sessionInputs.prism colors must be distinct',
    })
  })

  it.each([
    [[1, 2, 3]],
    [[1, 2, 3, 6]],
    [[1, 2, 3, 4.5]],
    [['1', 2, 3, 4]],
  ])('rejects invalid microCheck %j', (microCheck) => {
    const result = validateSessionInputs({
      prism: {
        impulse: PRISM_COLORS[0],
        need: PRISM_COLORS[1],
        identity: PRISM_COLORS[2],
        microCheck,
      },
    })

    expect(result.ok).toBe(false)
  })

  it('preserves future system keys in the generic bag', () => {
    const result = validateSessionInputs({ futureSystem: { draw: 7 } })
    expect(result).toEqual({
      ok: true,
      value: { futureSystem: { draw: 7 } },
    })
  })

  it('accepts a user-drawn tarot spread with unique 1-based positions', () => {
    const result = validateSessionInputs({
      tarot: { spread: 3, pickedPositions: [14, 3, 71] },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value?.tarot).toEqual({ spread: 3, pickedPositions: [14, 3, 71] })
    }
  })

  it('rejects tarot picks that duplicate or miss the spread length', () => {
    expect(
      validateSessionInputs({ tarot: { spread: 3, pickedPositions: [1, 1, 2] } }).ok,
    ).toBe(false)
    expect(
      validateSessionInputs({ tarot: { spread: 3, pickedPositions: [1, 2] } }).ok,
    ).toBe(false)
  })

  it('still accepts legacy rune counts from 1 to 24 (pre-cloth clients)', () => {
    expect(validateSessionInputs({ runes: { count: 1 } }).ok).toBe(true)
    expect(validateSessionInputs({ runes: { count: 5 } }).ok).toBe(true)
    expect(validateSessionInputs({ runes: { count: 24 } }).ok).toBe(true)
    expect(validateSessionInputs({ runes: { count: 0 } }).ok).toBe(false)
    expect(validateSessionInputs({ runes: { count: 25 } }).ok).toBe(false)
  })

  it('accepts the rune cloth draw: spread 1/3/5 with unique 1-based stone picks', () => {
    const result = validateSessionInputs({
      runes: { spread: 3, pickedPositions: [24, 1, 12] },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value?.runes).toEqual({ spread: 3, pickedPositions: [24, 1, 12] })
    }
  })

  it('rejects rune picks outside the cloth, duplicated, mismatched, or with a bad spread', () => {
    expect(validateSessionInputs({ runes: { spread: 3, pickedPositions: [0, 1, 2] } }).ok).toBe(false)
    expect(validateSessionInputs({ runes: { spread: 3, pickedPositions: [1, 1, 2] } }).ok).toBe(false)
    expect(validateSessionInputs({ runes: { spread: 3, pickedPositions: [1, 2] } }).ok).toBe(false)
    expect(validateSessionInputs({ runes: { spread: 3, pickedPositions: [1, 2, 25] } }).ok).toBe(false)
    expect(validateSessionInputs({ runes: { spread: 2, pickedPositions: [1, 2] } }).ok).toBe(false)
  })

  it('accepts a user-cast 육효: exactly six lines of 6/7/8/9, bottom-up', () => {
    const result = validateSessionInputs({ iching: { lines: [7, 8, 9, 6, 7, 8] } })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value?.iching).toEqual({ lines: [7, 8, 9, 6, 7, 8] })
    }
  })

  it('rejects a 육효 cast with the wrong count or non-line values', () => {
    expect(validateSessionInputs({ iching: { lines: [7, 8, 9, 6, 7] } }).ok).toBe(false)
    expect(validateSessionInputs({ iching: { lines: [7, 8, 9, 6, 7, 5] } }).ok).toBe(false)
    expect(validateSessionInputs({ iching: { lines: 'cast' } }).ok).toBe(false)
  })
})
