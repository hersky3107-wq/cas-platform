import { describe, expect, it, vi } from 'vitest'
import {
  RETRY_AFTER_CAP_MS,
  canHonor429Retry,
  cappedRetryAfterMs,
  httpErrorWithRetryAfter,
  parseRetryAfterMs,
  plan429Retry,
  retryAfterFromError,
  waitThenRetry429,
} from '../http-429-retry'

describe('429 retry with Retry-After', () => {
  it('parses seconds and HTTP-date Retry-After and caps at 30s', () => {
    expect(parseRetryAfterMs('12')).toBe(12_000)
    expect(cappedRetryAfterMs(90_000)).toBe(RETRY_AFTER_CAP_MS)
    const later = new Date(Date.now() + 8_000).toUTCString()
    const parsed = parseRetryAfterMs(later)
    expect(parsed).toBeGreaterThan(0)
    expect(parsed).toBeLessThanOrEqual(10_000)
  })

  it('reads retry-after from an HTTP error and retries once after the wait', async () => {
    expect(retryAfterFromError('HTTP 429 Too Many Requests; retry-after=5 - rate')).toBe(5_000)
    expect(canHonor429Retry({ waitMs: 5_000, remainingBudgetMs: 20_000 })).toBe(true)
    expect(canHonor429Retry({ waitMs: 5_000, remainingBudgetMs: 4_000 })).toBe(false)
    expect(plan429Retry({ error: 'HTTP 429; retry-after=40', remainingBudgetMs: 50_000 }).waitMs).toBe(30_000)

    const sleeps: number[] = []
    const logs: string[] = []
    const second = await waitThenRetry429({
      first: { error: 'HTTP 429; retry-after=2', text: null },
      errorOf: (value) => value.error,
      retry: async () => ({ error: undefined, text: '{"direction":"up"}' }),
      remainingBudgetMs: 20_000,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      log: (line) => logs.push(line),
      label: 'gpt-5-search-api',
    })
    expect(sleeps).toEqual([2_000])
    expect(logs[0]).toMatch(/429 retry model=gpt-5-search-api wait_ms=2000/)
    expect(second.text).toContain('direction')
  })

  it('does not retry when the wait would exceed the leftover tick budget', async () => {
    const retry = vi.fn(async () => ({ error: undefined, text: 'ok' }))
    const out = await waitThenRetry429({
      first: { error: 'HTTP 429; retry-after=20', text: null },
      errorOf: (value) => value.error,
      retry,
      remainingBudgetMs: 5_000,
    })
    expect(retry).not.toHaveBeenCalled()
    expect(out.error).toContain('429')
  })

  it('tags Retry-After on the HTTP error string', () => {
    const headers = { get: (name: string) => (name.toLowerCase() === 'retry-after' ? '8' : null) }
    expect(httpErrorWithRetryAfter({ status: 429, statusText: 'Too Many Requests', headers })).toBe(
      'HTTP 429 Too Many Requests; retry-after=8',
    )
  })
})
