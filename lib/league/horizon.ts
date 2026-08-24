import type { PredictionCategory } from '@/lib/prediction/categories'

/**
 * AI Prediction League — HORIZON SELECTION (pure).
 *
 * `prediction_rounds.horizon` has existed as a free-text column since the
 * original ledger migration (20260813000001_prediction_ledger.sql) — "kept as
 * free text so new horizons need no migration."
 *
 * ONE VOCABULARY, END TO END: the 4 codes below (`1d` / `1w` / `1m` / `3m`)
 * are BOTH the UI-facing option AND the exact string stored on the round.
 * There is no UI-vs-DB translation table — the value the user selects is the
 * value written to `prediction_rounds.horizon` and the value read back on the
 * card. (The single legacy `24h` row that predated this was backfilled to
 * `1d`; the CHECK constraint in 20260824000001 pins the column to these 4.)
 *
 * This module is the single place that:
 *  1. defines/validates the 4 canonical horizon codes;
 *  2. computes `resolves_at` from an anchor timestamp, honoring the rule
 *     "trading sessions for equities/ETFs, calendar days for crypto/FX";
 *  3. buckets the idempotency cache key at a granularity matching the
 *     horizon's own cadence, so a 1-month round opens once a month, not
 *     once a day — see `cacheBucketFor`.
 *
 * EACH HORIZON IS A SEPARATE ROUND. Nothing here ever mutates or
 * reinterprets an existing round's `resolves_at`; a new bucket simply makes
 * a NEW round eligible to be opened once the previous one's period has
 * passed (see `lib/league/catalog.ts` / `lib/league/public-access.ts`).
 */

export const UI_HORIZONS = ['1d', '1w', '1m', '3m'] as const
export type UiHorizon = (typeof UI_HORIZONS)[number]

export function isUiHorizon(value: unknown): value is UiHorizon {
  return typeof value === 'string' && (UI_HORIZONS as readonly string[]).includes(value)
}

/**
 * "Trading sessions for equities/ETFs, calendar days for crypto/FX" — the
 * two categories graded on exchange session closes vs. the ones that trade
 * (and are graded) every calendar day.
 */
const TRADING_SESSION_CATEGORIES: ReadonlySet<PredictionCategory> = new Set(['stock', 'etf_index'])

export function usesTradingSessions(category: PredictionCategory | string): boolean {
  return TRADING_SESSION_CATEGORIES.has(category as PredictionCategory)
}

/**
 * Trading-session count per horizon (Mon–Fri weekday count; no exchange
 * holiday calendar is wired up, so this is a weekday approximation — the
 * same approximation documented on `addTradingDays` below).
 */
export const TRADING_SESSION_COUNT: Record<UiHorizon, number> = {
  '1d': 1,
  '1w': 5,
  '1m': 21,
  '3m': 63,
}

/** Calendar-day count per horizon for categories that trade every day. */
export const CALENDAR_DAY_COUNT: Record<UiHorizon, number> = {
  '1d': 1,
  '1w': 7,
  '1m': 30,
  '3m': 90,
}

/**
 * How many daily bars ahead the base rate / `resolves_at` counts for this
 * (category, horizon). Equities/ETFs: trading sessions. Crypto/FX: calendar
 * days (those series include weekend bars). Unknown horizon → 1 (1d).
 */
export function sessionsForHorizon(category: PredictionCategory | string, horizon: string): number {
  const h = isUiHorizon(horizon) ? horizon : '1d'
  return usesTradingSessions(category) ? TRADING_SESSION_COUNT[h] : CALENDAR_DAY_COUNT[h]
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Adds `n` WEEKDAYS (Mon–Fri) to a timestamp, landing on a weekday.
 *
 * APPROXIMATION, documented: this skips weekends only. There is no exchange
 * holiday calendar wired into this codebase (no holiday-calendar API is
 * called anywhere in `lib/league`), so a US market holiday inside the window
 * is not skipped. Grading itself never assumes a session existed —
 * `resolveRoundOutcome` in `lib/prediction/resolution.ts` picks whatever
 * daily bar actually closed inside the window, or refuses with
 * `no_session_in_window` — so an occasional holiday inside the window makes
 * grading pick the next real session, never a wrong one.
 */
export function addTradingDays(fromMs: number, n: number): number {
  let ms = fromMs
  let remaining = n
  while (remaining > 0) {
    ms += DAY_MS
    const day = new Date(ms).getUTCDay() // 0 = Sunday, 6 = Saturday
    if (day !== 0 && day !== 6) remaining -= 1
  }
  return ms
}

/**
 * `resolves_at` for a NEW round, from its anchor observation time.
 *
 *  - equities/ETF (`usesTradingSessions`): anchor + N trading sessions
 *    (weekday-skip approximation — see `addTradingDays`).
 *  - crypto/FX and everything else: anchor + N calendar days (these trade,
 *    and are graded, every day of the week).
 */
export function computeResolvesAt(
  category: PredictionCategory | string,
  horizon: UiHorizon,
  anchorIso: string
): string {
  const anchorMs = Date.parse(anchorIso)
  const ms = usesTradingSessions(category)
    ? addTradingDays(anchorMs, TRADING_SESSION_COUNT[horizon])
    : anchorMs + CALENDAR_DAY_COUNT[horizon] * DAY_MS
  return new Date(ms).toISOString()
}

/**
 * Compliance-facing disclosure for the WEEKDAY-COUNT APPROXIMATION behind
 * `addTradingDays` (see its doc comment): no exchange holiday calendar is
 * wired into this codebase, so "N trading sessions out" is really "N
 * weekdays out". This must be surfaced ON THE PROPOSITION ITSELF, not only
 * in a code comment nobody reading the card ever sees — a reader is never
 * told a precision ("21 trading sessions") the app cannot actually back.
 *
 * Null for `'1d'` (an off-by-one-holiday deadline shift is immaterial to a
 * next-session round) and for calendar-day categories (crypto/FX trade,
 * and are graded, every day — no approximation is made there at all).
 */
export function tradingApproximationNote(category: PredictionCategory | string, horizon: UiHorizon): string | null {
  if (horizon === '1d') return null
  if (!usesTradingSessions(category)) return null
  return 'this date is estimated by counting weekdays, not an exchange holiday calendar'
}

function isoWeekStart(date: Date): string {
  // ISO week starts Monday. getUTCDay(): 0=Sun..6=Sat: Monday offset = (day+6)%7.
  const day = date.getUTCDay()
  const offset = (day + 6) % 7
  const monday = new Date(date.getTime() - offset * DAY_MS)
  return monday.toISOString().slice(0, 10)
}

/**
 * Idempotency bucket for the cache key, at a granularity matching the
 * horizon's own cadence: a 1-day round opens once per UTC day, a 1-week
 * round once per ISO week, a 1-month round once per UTC calendar month, a
 * 3-month round once per UTC calendar quarter. This is what makes "today's
 * round for this (instrument, horizon)" mean "the currently-open round for
 * that horizon" rather than spawning a new overlapping round every day while
 * a long-horizon round is still pending — see the module doc comment.
 */
export function cacheBucketFor(horizon: UiHorizon, now: Date): string {
  if (horizon === '1d') return now.toISOString().slice(0, 10)
  if (horizon === '1w') return isoWeekStart(now)
  const year = now.getUTCFullYear()
  if (horizon === '1m') return `${year}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1
  return `${year}-Q${quarter}`
}
