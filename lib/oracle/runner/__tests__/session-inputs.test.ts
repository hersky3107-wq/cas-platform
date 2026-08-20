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
})
