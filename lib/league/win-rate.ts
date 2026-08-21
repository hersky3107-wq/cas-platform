import { MIN_GRADED_ROUNDS_FOR_WIN_RATE } from './credits'
import type { LeagueUiPack } from './i18n/dictionary'

/**
 * AI Prediction League — WIN-RATE DISPLAY GATE (pure, no I/O).
 *
 * THE ONE PLACE a ratio is allowed to become a percentage. Every surface that
 * could show accuracy — leaderboard tabs, the card's accuracy badge, the
 * camp/tier/method/brand/country aggregates, the combined-method track record —
 * goes through here, so the minimum-sample rule cannot be enforced in one
 * component and forgotten in the next.
 *
 * THE RULE, and why it is not cosmetic:
 *  1. Below `MIN_GRADED_ROUNDS_FOR_WIN_RATE` graded rounds there is NO
 *     percentage — not dimmed, not small, not in a tooltip. The raw record is
 *     shown instead ("1W 0L, sample too small"). The first grading pass gives
 *     every model n=1, which would otherwise render as "100% accuracy": a
 *     meaningless number that reads exactly like the guaranteed-return claim
 *     that 유사투자자문 advertising rules in Korea prohibit.
 *  2. Below the threshold there is also no RANK, because a rank derived from a
 *     1-round win rate smuggles the same claim back in as an ordinal.
 *  3. A percentage is never displayed without its n beside it, at the same
 *     weight — see `LeagueUiPack.winRate.withSample`, which builds the two as a
 *     single string so no component can render one without the other.
 *  4. Percentages TRUNCATE toward zero, never round up: 2/3 shows as 66.6%, not
 *     66.7%. Rounding up is a (tiny) upgrade of a performance claim, and this
 *     module never makes one.
 */

export const WIN_RATE_MIN_SAMPLE = MIN_GRADED_ROUNDS_FOR_WIN_RATE

export type WinRateDisplay =
  /** n >= threshold: a percentage may be shown, and only ever with `n`. */
  | { kind: 'rate'; pct: number; pctText: string; n: number; correct: number; losses: number }
  /** 0 < n < threshold: raw record only. NO percentage exists in this shape. */
  | { kind: 'insufficient'; n: number; correct: number; losses: number }
  /** Nothing graded yet. */
  | { kind: 'empty' }

/** True when a percentage may be displayed at all. */
export function isDisplayableWinRate(resolved: number): boolean {
  return resolved >= WIN_RATE_MIN_SAMPLE
}

/** TRUNCATES to one decimal — never rounds a claim upward. 2/3 -> 66.6. */
export function truncateWinRatePct(correct: number, resolved: number): number {
  if (resolved <= 0) return 0
  return Math.floor((correct / resolved) * 1000) / 10
}

/**
 * The percentage a data payload is allowed to carry: null below the threshold,
 * so a client that ignores every other field STILL cannot render a low-sample
 * rate. Callers put this in `winRatePct` / `hitRatePct`.
 */
export function winRatePctForDisplay(correct: number, resolved: number): number | null {
  if (!isDisplayableWinRate(resolved)) return null
  return truncateWinRatePct(correct, resolved)
}

/** '62' / '66.6' — integers stay bare, never "62.0%". */
export function formatWinRatePct(pct: number): string {
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1)
}

export function winRateDisplay(correct: number, resolved: number): WinRateDisplay {
  if (resolved <= 0) return { kind: 'empty' }
  const losses = Math.max(0, resolved - correct)
  if (!isDisplayableWinRate(resolved)) return { kind: 'insufficient', n: resolved, correct, losses }
  const pct = truncateWinRatePct(correct, resolved)
  return { kind: 'rate', pct, pctText: formatWinRatePct(pct), n: resolved, correct, losses }
}

/**
 * The localized string for a win rate. A percentage can only leave this function
 * with its sample size attached; 100% and 0% are no exception (they are the two
 * values most likely to be screenshotted out of context).
 */
export function winRateLabel(display: WinRateDisplay, t: LeagueUiPack): string {
  switch (display.kind) {
    case 'rate':
      return t.winRate.withSample(display.pctText, display.n)
    case 'insufficient':
      return t.winRate.insufficient(display.correct, display.losses)
    case 'empty':
      return t.winRate.noRounds
  }
}
