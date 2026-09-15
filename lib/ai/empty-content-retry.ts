/**
 * HTTP-200-empty-content retry policy for OpenAI-compatible platform calls
 * (OpenRouter / Meta Muse / Upstage / Friendli).
 *
 * Upstream flake: HTTP 200, `message.content` null/blank, answer sometimes
 * only in `message.reasoning`. Not a timeout and not a missing-seat skip —
 * bounded retries then the league no-opinion gate excludes the seat.
 */

/** Total HTTP tries for one empty-content episode (1 first + up to 3 retries). */
export const EMPTY_CONTENT_MAX_ATTEMPTS = 4

/** Extra tries after the first empty 200. */
export const EMPTY_CONTENT_MAX_RETRIES = EMPTY_CONTENT_MAX_ATTEMPTS - 1

/**
 * Abort each empty-content retry at this wall. The first attempt still uses
 * the caller's roster/oracle timeout. Short retries stop a flaky seat from
 * occupying a chunk for minutes (live: 537s on stacked full-timeout retries).
 */
export const EMPTY_CONTENT_RETRY_TIMEOUT_MS = 20_000

/** Backoff before retry 1, 2, 3 (ms). */
export const EMPTY_CONTENT_BACKOFF_MS: readonly number[] = [300, 800, 1_500]

export function emptyContentRetryBackoffMs(retryIndex: number): number {
  return EMPTY_CONTENT_BACKOFF_MS[retryIndex] ?? EMPTY_CONTENT_BACKOFF_MS[EMPTY_CONTENT_BACKOFF_MS.length - 1]!
}

/** Wall added on top of the first-attempt timeout for the inner retry loop. */
export function emptyContentRetryBudgetMs(): number {
  return (
    EMPTY_CONTENT_MAX_RETRIES * EMPTY_CONTENT_RETRY_TIMEOUT_MS +
    EMPTY_CONTENT_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0)
  )
}

export function isEmptyContentError(error?: string | null): boolean {
  if (!error) return false
  const m = error.toLowerCase()
  return m.includes('message.content was empty') || m.includes('empty message.content')
}
