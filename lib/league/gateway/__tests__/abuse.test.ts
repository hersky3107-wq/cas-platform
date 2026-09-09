import { describe, expect, it } from 'vitest'
import { normalizeCacheKey, quotaUnitsFor, quotaWouldBreach } from '../abuse'

describe('gateway abuse helpers', () => {
  it('cache-keys by category + collapsed text + locale', () => {
    const a = normalizeCacheKey('stocks', '  애플   내일 오를까? ', 'ko')
    const b = normalizeCacheKey('stocks', '애플 내일 오를까?', 'ko')
    const c = normalizeCacheKey('crypto', '애플 내일 오를까?', 'ko')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it('quota: cache hit free, clarify miss half, fresh miss one', () => {
    expect(quotaUnitsFor({ cacheHit: true, isClarification: false })).toBe(0)
    expect(quotaUnitsFor({ cacheHit: true, isClarification: true })).toBe(0)
    expect(quotaUnitsFor({ cacheHit: false, isClarification: true })).toBe(0.5)
    expect(quotaUnitsFor({ cacheHit: false, isClarification: false })).toBe(1)
    expect(quotaWouldBreach(19.6, 0.5)).toBe(true)
    expect(quotaWouldBreach(19, 1)).toBe(false)
  })
})
