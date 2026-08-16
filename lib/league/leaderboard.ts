import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { buildLeaderboardData, type GradedPredictionRow, type LeaderboardData } from './leaderboard-aggregate'

export { buildLeaderboardData }
export type { LeaderboardData }

/**
 * AI Prediction League — LEADERBOARD, DB read path.
 *
 * ONE query pass: fetch every graded, in-scope `model_predictions` row
 * (joined to its round only for `category` + `item_type`), then hand the
 * whole set to the pure `buildLeaderboardData` (see `leaderboard-aggregate.ts`)
 * to compute all four slices. No per-slice queries, no client-side
 * aggregation.
 *
 * In-scope filters (applied at the query level, see module doc in
 * `leaderboard-aggregate.ts` for why each exists):
 *   - `is_correct is not null`
 *   - `league_tier != 'scout'`
 *   - joined round's `item_type = 'ranked'` (excludes on-demand/live-preview rounds)
 *   - optionally, `category in (...)` — see `LeaderboardScope`
 *
 * Read-only. Never writes, never touches scoring/cron/reconciliation.
 */

type GradedQueryRow = {
  model_id: string
  brand: string
  camp: string
  league_tier: string
  is_correct: boolean | null
  prediction_rounds: { category: string; item_type: string } | null
}

export type LeaderboardScope = {
  /**
   * Restrict to these categories. Set by the API route to the caller's
   * jurisdiction-visible categories, so a user never sees rankings built from
   * a category they are not allowed to view. An EMPTY array means "nothing
   * visible" (default-deny) and short-circuits to an empty leaderboard —
   * omitting the field entirely is the unfiltered admin view.
   */
  categories?: readonly string[]
}

export async function fetchLeaderboardData(scope?: LeaderboardScope): Promise<LeaderboardData> {
  if (scope?.categories && scope.categories.length === 0) {
    return buildLeaderboardData([])
  }

  let query = supabaseAdmin
    .from('model_predictions')
    .select('model_id, brand, camp, league_tier, is_correct, prediction_rounds!inner(category, item_type)')
    .not('is_correct', 'is', null)
    .neq('league_tier', 'scout')
    .eq('prediction_rounds.item_type', 'ranked')

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
    }))

  return buildLeaderboardData(rows)
}
