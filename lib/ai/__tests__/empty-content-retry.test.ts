import { describe, expect, it } from 'vitest'
import {
  EMPTY_CONTENT_MAX_ATTEMPTS,
  EMPTY_CONTENT_MAX_RETRIES,
  EMPTY_CONTENT_RETRY_TIMEOUT_MS,
  emptyContentRetryBackoffMs,
  emptyContentRetryBudgetMs,
  isEmptyContentError,
} from '../empty-content-retry'

describe('empty-content retry policy', () => {
  it('is 1 first attempt + 5 retries (6 HTTP max) with ≥35s retry abort', () => {
    expect(EMPTY_CONTENT_MAX_ATTEMPTS).toBe(6)
    expect(EMPTY_CONTENT_MAX_RETRIES).toBe(5)
    expect(EMPTY_CONTENT_RETRY_TIMEOUT_MS).toBeGreaterThanOrEqual(35_000)
    expect(EMPTY_CONTENT_RETRY_TIMEOUT_MS).toBe(35_000)
    expect(emptyContentRetryBackoffMs(0)).toBe(1_000)
    expect(emptyContentRetryBackoffMs(1)).toBe(2_000)
    expect(emptyContentRetryBackoffMs(2)).toBe(4_000)
    expect(emptyContentRetryBackoffMs(3)).toBe(6_000)
    expect(emptyContentRetryBackoffMs(4)).toBe(8_000)
  })

  it('outer wall covers every retry and stays below the 537s stacked-timeout loop', () => {
    const budget = emptyContentRetryBudgetMs()
    expect(budget).toBe(5 * 35_000 + 1_000 + 2_000 + 4_000 + 6_000 + 8_000)
    expect(budget).toBe(196_000)
    const defaultSeatWall = 60_000 + budget
    expect(defaultSeatWall).toBe(256_000)
    expect(defaultSeatWall).toBeLessThan(537_000)
  })

  it('detects the platform empty-content error string', () => {
    expect(
      isEmptyContentError(
        'HTTP 200 but message.content was empty (finish_reason=stop). Raw: {}'
      )
    ).toBe(true)
    expect(isEmptyContentError('timeout after 60000ms')).toBe(false)
    expect(isEmptyContentError('HTTP 429 rate limit')).toBe(false)
  })
})
