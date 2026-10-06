import { describe, expect, it } from 'vitest'
import { timeoutRetryFits } from '../seat-timeout'

describe('timeout retry budget', () => {
  it('allows one retry when another full seat timeout still fits', () => {
    expect(timeoutRetryFits(90_000, 90_000)).toBe(true)
    expect(timeoutRetryFits(120_000, 90_000)).toBe(true)
    expect(timeoutRetryFits(89_999, 90_000)).toBe(false)
    expect(timeoutRetryFits(null, 90_000)).toBe(true)
  })
})
