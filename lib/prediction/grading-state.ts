/**
 * AI Prediction League — GRADING STATE (pure).
 *
 * ONE null used to mean three different things ("not due yet", "due but nobody
 * graded it", "we tried and refused"). This module derives the distinction from
 * the row itself, so there is no stored status string that can drift out of
 * sync with `actual_outcome` / `resolves_at`.
 *
 * The leaderboard counts ONLY `graded` rounds in its denominator and reports
 * `unresolvable` separately — an ungraded round is surfaced, never hidden.
 */

export type GradingState =
  /** resolves_at is still in the future — nothing to do. */
  | 'not_due'
  /** Due, ungraded, no attempt on record: the next read or sweep will grade it. */
  | 'due_ungraded'
  /** A claim lease is in flight right now (some reader/sweep is grading it). */
  | 'grading'
  /** Graded: actual_outcome + resolution audit pair persisted. */
  | 'graded'
  /** Due, ungraded, and the last attempt refused with a recorded reason. */
  | 'unresolvable'

/** The only fields that decide grading state. */
export type GradingStateRow = {
  resolves_at: string
  actual_outcome: string | null
  resolved_at: string | null
  grading_busy_until: string | null
  grading_attempted_at: string | null
  unresolvable_reason: string | null
}

/** How long a grading claim is held. Long enough for one time_series call + writes. */
export const GRADING_CLAIM_MS = 120_000

/**
 * Minimum gap between grade-on-read ATTEMPTS for the same round. Without it, a
 * permanently-unresolvable round (e.g. no anchor_price) would re-attempt on
 * every single page view. The admin sweep ignores this deliberately — it is a
 * per-view anti-thrash rule, not a filter over which rounds get graded.
 */
export const GRADING_READ_COOLDOWN_MS = 900_000

function futureMs(iso: string | null, nowMs: number): boolean {
  if (!iso) return false
  const ms = Date.parse(iso)
  return Number.isFinite(ms) && ms > nowMs
}

export function gradingStateOf(row: GradingStateRow, nowMs: number): GradingState {
  if (row.actual_outcome !== null || row.resolved_at !== null) return 'graded'

  const resolvesMs = Date.parse(row.resolves_at)
  if (!Number.isFinite(resolvesMs) || resolvesMs > nowMs) return 'not_due'

  // A claim in flight outranks a recorded reason: this is a retry in progress.
  if (futureMs(row.grading_busy_until, nowMs)) return 'grading'
  if (row.unresolvable_reason !== null) return 'unresolvable'
  return 'due_ungraded'
}

/** True while the read path should leave this round alone (see GRADING_READ_COOLDOWN_MS). */
export function isReadCooldownActive(row: GradingStateRow, nowMs: number): boolean {
  if (!row.grading_attempted_at) return false
  const attemptedMs = Date.parse(row.grading_attempted_at)
  if (!Number.isFinite(attemptedMs)) return false
  return attemptedMs + GRADING_READ_COOLDOWN_MS > nowMs
}
