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
  it('is 1 first attempt + 3 short retries (4 HTTP max)', () => {
    expect(EMPTY_CONTENT_MAX_ATTEMPTS).toBe(4)
    expect(EMPTY_CONTENT_MAX_RETRIES).toBe(3)
    expect(EMPTY_CONTENT_RETRY_TIMEOUT_MS).toBe(20_000)
    expect(emptyContentRetryBackoffMs(0)).toBe(300)
    expect(emptyContentRetryBackoffMs(1)).toBe(800)
    expect(emptyContentRetryBackoffMs(2)).toBe(1_500)
  })

  it('retry budget is far below a 537s stacked full-timeout loop', () => {
    const budget = emptyContentRetryBudgetMs()
    expect(budget).toBe(3 * 20_000 + 300 + 800 + 1_500)
    expect(budget).toBeLessThan(70_000)
    expect(60_000 + budget).toBeLessThan(200_000)
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
