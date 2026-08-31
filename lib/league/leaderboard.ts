import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { gradingStateOf } from '@/lib/prediction/grading-state'
import {
  buildLeaderboardData,
  emptyRoundCoverage,
  type GradedPredictionRow,
  type LeaderboardData,
  type RoundCoverage,
} from './leaderboard-aggregate'

export { buildLeaderboardData }
export type { LeaderboardData }

/**
 * AI Prediction League — LEADERBOARD, DB read path.
 *
 * ONE query pass: fetch every graded, in-scope `model_predictions` row
 * (joined to its round for `category` + `item_type`), then hand the whole
 * set to the pure `buildLeaderboardData`.
 *
 * In-scope filters (applied at the query level):
 *   - `is_correct is not null` — graded under the standard contract
 *   - optionally, `category in (...)` — see `LeaderboardScope`
 *
 * Creation mode (`item_type` ranked vs on_demand) is provenance, not a quality
 * tier: once a round is graded, it enters the track record. Public catalog
 * generates are already `ranked`; `on_demand` is mostly admin/script provenance.
 *
 * Plus ONE more query for round-level coverage (`fetchRoundCoverage`): the win
 * rates' denominators count graded rounds only, so the number of rounds that are
 * ungraded or unresolvable is reported alongside them instead of vanishing.
 *
 * Scout is INCLUDED. Directional grading applies to scout the same as every
 * other tier; do not re-add a `league_tier != 'scout'` filter.
 *
 * Read-only. Never writes, never touches scoring/cron/reconciliation.
 */

type GradedQueryRow = {
  model_id: string
  brand: string
  camp: string
  league_tier: string
  is_correct: boolean | null
  predicted_direction: string | null
  round_id: string
  prediction_rounds: { category: string; item_type: string } | null
}

export type LeaderboardScope = {
  /**
   * Restrict to these categories. Set by the API route to the caller's
   * jurisdiction-visible categories. An EMPTY array means "nothing visible"
   * (default-deny) and short-circuits to an empty leaderboard — omitting
   * the field entirely is the unfiltered admin view.
   */
  categories?: readonly string[]
}


/**
 * Round-level accounting for the same scope as the win rates: how many
 * rounds are graded, and how many are due-but-ungraded / unresolvable / not yet
 * due. ONE query over the rounds table (rounds number in the dozens, so this is
 * cheaper than four count queries), classified by the shared
 * `gradingStateOf` — the leaderboard cannot invent a definition of "graded" that
 * differs from the grading engine's.
 *
 * Degrades to zeros if the grading-state columns are not migrated yet, rather
 * than failing the whole leaderboard read.
 */
async function fetchRoundCoverage(scope?: LeaderboardScope): Promise<RoundCoverage> {
  let query = supabaseAdmin
    .from('prediction_rounds')
    .select('resolves_at, actual_outcome, resolved_at, grading_busy_until, grading_attempted_at, unresolvable_reason')
  if (scope?.categories) query = query.in('category', scope.categories as string[])

  const { data, error } = await query
  if (error || !data) return emptyRoundCoverage()

  const nowMs = Date.now()
  const coverage = emptyRoundCoverage()
  for (const row of data as Record<string, unknown>[]) {
    const state = gradingStateOf(
      {
        resolves_at: String(row.resolves_at ?? ''),
        actual_outcome: (row.actual_outcome as string | null) ?? null,
        resolved_at: (row.resolved_at as string | null) ?? null,
        grading_busy_until: (row.grading_busy_until as string | null) ?? null,
        grading_attempted_at: (row.grading_attempted_at as string | null) ?? null,
        unresolvable_reason: (row.unresolvable_reason as string | null) ?? null,
      },
      nowMs
    )
    if (state === 'graded') coverage.graded += 1
    else if (state === 'unresolvable') coverage.unresolvable += 1
    else if (state === 'not_due') coverage.notDue += 1
    else coverage.dueUngraded += 1
  }
  return coverage
}

export async function fetchLeaderboardData(scope?: LeaderboardScope): Promise<LeaderboardData> {
  if (scope?.categories && scope.categories.length === 0) {
    return buildLeaderboardData([])
  }

  let query = supabaseAdmin
    .from('model_predictions')
    .select(
      'model_id, brand, camp, league_tier, is_correct, predicted_direction, round_id, prediction_rounds!inner(category, item_type)'
    )
    .not('is_correct', 'is', null)

  if (scope?.categories) {
    query = query.in('prediction_rounds.category', scope.categories as string[])
  }

  const { data, error } = await query

  if (error) throw new Error(`league leaderboard: query failed (${error.message})`)

  const rows: GradedPredictionRow[] = ((data ?? []) as unknown as GradedQueryRow[])
    .filter((row): row is GradedQueryRow & { is_correct: boolean; prediction_rounds: { category: string; item_type: string } } =>
      row.is_correct !== null && row.prediction_rounds !== null
    )
    .map((row) => ({
      model_id: row.model_id,
      brand: row.brand,
      camp: row.camp,
      league_tier: row.league_tier,
      category: row.prediction_rounds.category,
      is_correct: row.is_correct,
      round_id: row.round_id,
      // Raw token, passed through: `buildCombinedMethodTrack` gates it with
      // `toSideToken`, so a graded yes/no/above/below row is a real vote in
      // the combined-method majority — never silently an abstention.
      predicted_direction: row.predicted_direction,
    }))

  return buildLeaderboardData(rows, await fetchRoundCoverage(scope))
}
