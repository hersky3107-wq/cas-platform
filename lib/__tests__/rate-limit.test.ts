import { beforeEach, describe, expect, it } from 'vitest'
import { checkRateLimit, resetRateLimits } from '../rate-limit'

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimits()
  })

  it('allows up to the limit inside one window, then rejects', () => {
    const rule = { limit: 3, windowMs: 60_000 }
    expect(checkRateLimit('u1', rule, 1_000).ok).toBe(true)
    expect(checkRateLimit('u1', rule, 1_100).ok).toBe(true)
    expect(checkRateLimit('u1', rule, 1_200).ok).toBe(true)
    expect(checkRateLimit('u1', rule, 1_300).ok).toBe(false)
  })

  it('reports remaining allowance on allowed calls', () => {
    const rule = { limit: 2, windowMs: 60_000 }
    const first = checkRateLimit('u1', rule, 1_000)
    const second = checkRateLimit('u1', rule, 1_010)
    expect(first).toEqual({ ok: true, remaining: 1 })
    expect(second).toEqual({ ok: true, remaining: 0 })
  })

  it('keys are independent — one user cannot exhaust another user allowance', () => {
    const rule = { limit: 1, windowMs: 60_000 }
    expect(checkRateLimit('user-a', rule, 1_000).ok).toBe(true)
    expect(checkRateLimit('user-a', rule, 1_001).ok).toBe(false)
    expect(checkRateLimit('user-b', rule, 1_002).ok).toBe(true)
  })

  it('allows again once the window slides past the old hits', () => {
    const rule = { limit: 1, windowMs: 10_000 }
    expect(checkRateLimit('u1', rule, 0).ok).toBe(true)
    expect(checkRateLimit('u1', rule, 5_000).ok).toBe(false)
    expect(checkRateLimit('u1', rule, 10_001).ok).toBe(true)
  })

  it('reports a retryAfterMs that lands when the oldest hit expires', () => {
    const rule = { limit: 1, windowMs: 10_000 }
    checkRateLimit('u1', rule, 1_000)
    const blocked = checkRateLimit('u1', rule, 4_000)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.retryAfterMs).toBe(7_000)
  })

  it('a rejected call does not extend the penalty window', () => {
    const rule = { limit: 1, windowMs: 10_000 }
    checkRateLimit('u1', rule, 0)
    // Hammering during the block must not push the reset time out.
    for (let t = 1_000; t < 10_000; t += 1_000) {
      expect(checkRateLimit('u1', rule, t).ok).toBe(false)
    }
    expect(checkRateLimit('u1', rule, 10_001).ok).toBe(true)
  })
})
