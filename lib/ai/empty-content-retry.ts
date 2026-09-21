/**
 * HTTP-200-empty-content retry policy for OpenAI-compatible platform calls
 * (OpenRouter / Meta Muse / Upstage / Friendli).
 *
 * Upstream flake: HTTP 200, `message.content` null/blank, answer sometimes
 * only in `message.reasoning`. Not a timeout and not a missing-seat skip —
 * bounded retries then the league no-opinion gate excludes the seat.
 *
 * Retry abort is ≥35s (not 20s): OpenRouter reasoning seats such as kimi-k3
 * and mimo-v2.5 often need 22–26s for a valid visible answer. A 20s retry
 * abort turns those into timeouts. Each retry uses a fresh abort — it must
 * not inherit leftover time from the first-attempt signal.
 */

/** Total HTTP tries for one empty-content episode (1 first + up to 5 retries). */
export const EMPTY_CONTENT_MAX_ATTEMPTS = 6

/** Extra tries after the first empty 200. */
export const EMPTY_CONTENT_MAX_RETRIES = EMPTY_CONTENT_MAX_ATTEMPTS - 1

/**
 * Abort each empty-content retry at this wall. The first attempt still uses
 * the caller's roster/oracle timeout. 35s covers 22–26s reasoning responses
 * without stacking full 60s seat timeouts (live: 537s on stacked full-timeout
 * retries).
 */
export const EMPTY_CONTENT_RETRY_TIMEOUT_MS = 35_000

/** Backoff before retries 1–5 (ms): 1s → 8s. */
export const EMPTY_CONTENT_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000, 6_000, 8_000]

export function emptyContentRetryBackoffMs(retryIndex: number): number {
  return EMPTY_CONTENT_BACKOFF_MS[retryIndex] ?? EMPTY_CONTENT_BACKOFF_MS[EMPTY_CONTENT_BACKOFF_MS.length - 1]!
}

/**
 * Wall added on top of the first-attempt timeout for the inner retry loop.
 * Orchestrator `platformWallMs = timeoutMs + emptyContentRetryBudgetMs()` so
 * this budget must grow with attempts/abort/backoff or the outer race cuts
 * the retries short.
 */
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
