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
export const LEAGUE_GENERATE_CREDITS = 7

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

/** credit_logs.module for a deep-open deduction. */
export const LEAGUE_DEEP_OPEN_MODULE = 'league_deep_open'

/** credit_logs.module for a deep-debate deduction. */
export const LEAGUE_DEEP_DEBATE_MODULE = 'league_deep_debate'
