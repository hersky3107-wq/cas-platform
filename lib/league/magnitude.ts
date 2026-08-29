import { isUiHorizon, type UiHorizon } from './horizon'

/**
 * Magnitude — a DECORATION on the binary up/down proposition, never a graded
 * fact. Each model states an expected signed percent move over the round's
 * horizon, alongside (never instead of) its direction + probability. The
 * proposition graded is unchanged: still exactly "up" or "down"
 * (`model_predictions.is_correct`). Nothing in this module is read by
 * `lib/league/round-hit.ts`, `lib/league/win-rate.ts`, or
 * `lib/prediction/resolution.ts` — see their own tests for the negative
 * assertion.
 *
 * Pure, no I/O — mirrors `log-odds-consensus.ts` / `open-phase.ts` so this is
 * unit-testable without a DB.
 */

export type MagnitudeDirection = 'up' | 'down'

/**
 * Sanity bound per horizon (percent, absolute value), applied regardless of
 * category. Chosen generously enough to admit real crypto/memecoin moves at
 * each horizon while still catching a garbled/hallucinated value (the
 * motivating case: a model returning +900% on a 1d equity call). This is a
 * blunt "that cannot be real" backstop, not a fitted distribution — the DB
 * CHECK constraint added in the migration is an even wider backstop behind
 * this one (defense in depth, not the primary gate).
 */
export const MAGNITUDE_BOUND_PCT: Record<UiHorizon, number> = {
  '1d': 30,
  '1w': 60,
  '1m': 120,
  '3m': 250,
}

export function magnitudeBoundForHorizon(horizon: string): number {
  return MAGNITUDE_BOUND_PCT[isUiHorizon(horizon) ? horizon : '1d']
}

export type MagnitudeInvalidReason = 'missing' | 'non_numeric' | 'sign_mismatch' | 'out_of_bounds'

export type MagnitudeValidation = { ok: true; value: number } | { ok: false; reason: MagnitudeInvalidReason }

/** Two decimal places — enough resolution for a percent-change qualifier, never displayed at full float precision. */
export function roundMagnitude(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Validates a model's stated magnitude against its OWN direction and the
 * round's horizon. Required, same as direction: missing/non-numeric is
 * treated by the caller (`orchestrator.ts`) exactly like a non-binary
 * direction — one retry, then error, never silently stored.
 *
 * Sign must match direction: 'up' allows magnitude >= 0, 'down' allows
 * magnitude <= 0. An exact 0 is accepted for either side — the direction
 * prompt already instructs "if you expect little change, still pick the
 * closer side", so a near-zero call legitimately does not contradict
 * whichever side was picked.
 */
export function validateMagnitude(
  direction: MagnitudeDirection,
  magnitude: number | null,
  horizon: string
): MagnitudeValidation {
  if (magnitude === null) return { ok: false, reason: 'missing' }
  if (!Number.isFinite(magnitude)) return { ok: false, reason: 'non_numeric' }
  if (direction === 'up' && magnitude < 0) return { ok: false, reason: 'sign_mismatch' }
  if (direction === 'down' && magnitude > 0) return { ok: false, reason: 'sign_mismatch' }
  const bound = magnitudeBoundForHorizon(horizon)
  if (Math.abs(magnitude) > bound) return { ok: false, reason: 'out_of_bounds' }
  return { ok: true, value: roundMagnitude(magnitude) }
}

/** '+2.4%' / '-1.1%' / '+0.0%' — ASCII sign, fixed decimals. Numerals + '%' read the same in all 8 league locales (like `formatInstrumentPrice`), so this is not routed through `LeagueUiPack`. */
export function formatSignedPercent(value: number, decimals = 1): string {
  const scale = 10 ** decimals
  const rounded = Math.round(value * scale) / scale
  const text = Math.abs(rounded).toFixed(decimals)
  return rounded < 0 ? `-${text}%` : `+${text}%`
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

export type MagnitudeAggregate = { medianPct: number | null; n: number }

/**
 * Aggregate magnitude for the headline: ONLY across models whose OWN
 * direction matches `aggregateDirection` — averaging a +3% up-call with a
 * -3% down-call would cancel toward a meaningless ~0. Median, not a
 * (trimmed) mean: `n` here is often small (as few as the minority-direction
 * count, on a close vote), and a trimmed mean's trim fraction is
 * unstable/undefined at small n, while the median stays well-defined and
 * robust to a single extreme value for any n >= 1.
 */
export function aggregateMagnitude(
  models: readonly { direction: string | null; magnitude: number | null }[],
  // Any contract-neutral side token. Magnitude only exists for close_higher
  // (up/down) rows, so other tokens simply yield n=0 — same math either way.
  aggregateDirection: string | null
): MagnitudeAggregate {
  if (!aggregateDirection) return { medianPct: null, n: 0 }
  const values = models
    .filter((m) => m.direction === aggregateDirection)
    .map((m) => m.magnitude)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const median = medianOf(values)
  return { medianPct: median === null ? null : roundMagnitude(median), n: values.length }
}

/**
 * Actual realized percent change over the round, from the SAME two prices
 * the card header already names (anchor close -> resolution close).
 * PRESENTATION ONLY — grading (`lib/prediction/resolution.ts`) decides
 * up/down from the sign of this same difference, but never reads this
 * percent figure itself, and no hit/win-rate calculation reads it either.
 */
export function computeActualMagnitudePct(anchorPrice: number | null, resolutionPrice: number | null): number | null {
  if (anchorPrice === null || resolutionPrice === null) return null
  if (!Number.isFinite(anchorPrice) || anchorPrice === 0 || !Number.isFinite(resolutionPrice)) return null
  return roundMagnitude(((resolutionPrice - anchorPrice) / anchorPrice) * 100)
}
