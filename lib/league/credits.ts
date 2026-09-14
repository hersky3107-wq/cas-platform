/**
 * AI Prediction League — paid-compute credit constants.
 *
 * THE single place league credit amounts live. Named constants only — never
 * inline these at a call site. Since 2026-09-14 nothing in the league is
 * free to view: a round card (LEAGUE_GENERATE_CREDITS, permanent per-user
 * access once paid), the leaderboard, and the record room are all paid.
 * The card READ route still never charges — that charge lives exclusively
 * on `POST /api/league/generate`.
 *
 * Re-exported from `lib/credits.ts` so existing client-safe imports keep working.
 */

/**
 * VIEW ACCESS to one round (2026-09-14 pricing): the same price whether the
 * press creates the round (cron job runs the full roster) or unlocks one
 * that already exists — the user is buying the same result either way, and
 * once paid, access is permanent per (round, user). Charged by
 * `POST /api/league/generate`; refunded in full when a generation job fails
 * terminally (see lib/league/generation/runner.ts).
 */
export const LEAGUE_GENERATE_CREDITS = 30

/**
 * Leaderboard (GET /api/league/leaderboard). Cheap promotional surface.
 * One purchase grants permanent access to the LIVE board — later grades
 * update the rankings. Receipt is `league_view_purchases` (not the jobs
 * table: there is no round_id).
 */
export const LEAGUE_LEADERBOARD_CREDITS = 2

/**
 * Record room listing. One purchase unlocks the 30 most recently resolved
 * rounds as of the purchase timestamp (frozen window). Reopening that
 * window does not charge again; sliding the window forward is a new
 * purchase. Receipt is `league_view_purchases`.
 */
export const LEAGUE_RECORD_ROOM_CREDITS = 10

/**
 * CSV export of an already-purchased record-room window. Separate and
 * higher than the listing: the listing is the product, the file is the
 * scrape vector. Full-history export is not offered on this tier.
 */
export const LEAGUE_ARCHIVE_CREDITS = 15

/** Open-ended deep analysis of an existing round (`POST /api/league/deep-open`). */
export const LEAGUE_DEEP_OPEN_CREDITS = 50

/** Pro/con debate of an existing round (`POST /api/league/deep-debate`). */
export const LEAGUE_DEEP_DEBATE_CREDITS = 70

export function creditsForLeagueGenerate(): number {
  return LEAGUE_GENERATE_CREDITS
}

export function creditsForLeagueLeaderboard(): number {
  return LEAGUE_LEADERBOARD_CREDITS
}

export function creditsForLeagueRecordRoom(): number {
  return LEAGUE_RECORD_ROOM_CREDITS
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

/** credit_logs.module for a leaderboard purchase. */
export const LEAGUE_LEADERBOARD_MODULE = 'league_leaderboard'

/** credit_logs.module for a record-room window purchase. */
export const LEAGUE_RECORD_ROOM_MODULE = 'league_record_room'

/** credit_logs.module for a deep-open deduction. */
export const LEAGUE_DEEP_OPEN_MODULE = 'league_deep_open'

/** credit_logs.module for a deep-debate deduction. */
export const LEAGUE_DEEP_DEBATE_MODULE = 'league_deep_debate'
