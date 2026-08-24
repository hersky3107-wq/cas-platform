/**
 * AI Prediction League — paid-compute credit constants.
 *
 * THE single place league credit amounts live. Named constants only — never
 * inline these at a call site. Cached league card reads (`GET /api/league/card`)
 * are free and must not use any of these.
 *
 * Re-exported from `lib/credits.ts` so existing client-safe imports keep working.
 */

/** One live re-run of a ranked round (full 40-model roster). */
export const LEAGUE_GENERATE_CREDITS = 30

/** Deep archive (full history, model filter, date range, CSV). Recent summary stays free. */
export const LEAGUE_ARCHIVE_CREDITS = 3

/** Open-ended deep analysis of an existing round (`POST /api/league/deep-open`). */
export const LEAGUE_DEEP_OPEN_CREDITS = 50

/** Pro/con debate of an existing round (`POST /api/league/deep-debate`). */
export const LEAGUE_DEEP_DEBATE_CREDITS = 70

export function creditsForLeagueGenerate(): number {
  return LEAGUE_GENERATE_CREDITS
}

export function creditsForLeagueArchive(): number {
  return LEAGUE_ARCHIVE_CREDITS
}

export function creditsForLeagueDeepOpen(): number {
  return LEAGUE_DEEP_OPEN_CREDITS
}

export function creditsForLeagueDeepDebate(): number {
  return LEAGUE_DEEP_DEBATE_CREDITS
}

/**
 * MINIMUM SAMPLE for showing a win rate as a PERCENTAGE. Below this, every
 * surface shows the raw record ("1W 0L, sample too small") and nothing is ranked
 * — see `lib/league/win-rate.ts`, which is the only module allowed to turn a
 * ratio into a displayable percentage.
 *
 * NOT a cosmetic threshold. One graded round would render as "100% accuracy",
 * which is both statistically meaningless and, for a service heading toward
 * 유사투자자문 registration in Korea, the shape of a prohibited guaranteed-return
 * advertising claim. It lives here with the other named league constants so
 * there is one number, changed in one place, never inlined at a call site.
 */
export const MIN_GRADED_ROUNDS_FOR_WIN_RATE = 10

/** credit_logs.module for a deep-open deduction. */
export const LEAGUE_DEEP_OPEN_MODULE = 'league_deep_open'

/** credit_logs.module for a deep-debate deduction. */
export const LEAGUE_DEEP_DEBATE_MODULE = 'league_deep_debate'
