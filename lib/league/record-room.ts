import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import {
  buildRecordRoomPage,
  type RecordRoomPage,
  type RecordRoomPredictionRow,
  type RecordRoomRoundRow,
} from './record-room-aggregate'

export { buildRecordRoomPage }
export type { RecordRoomPage }

export const RECORD_ROOM_DEFAULT_PAGE_SIZE = 20
export const RECORD_ROOM_MAX_PAGE_SIZE = 50

const ROUND_COLUMNS = 'id, proposition_text, category, color_bucket, instrument, resolved_at, actual_outcome'
const PREDICTION_COLUMNS = 'round_id, model_id, brand, camp, league_tier, predicted_direction, is_correct'

/**
 * AI Prediction League — RECORD ROOM, DB read path.
 *
 * Paginated by `resolved_at` descending (most recently resolved first). Two
 * queries per page: (1) the page of resolved rounds + a total count, (2)
 * every model_predictions row for just those rounds. Read-only — never
 * writes, never touches scoring/cron/reconciliation. See
 * `record-room-aggregate.ts` for why `item_type` is NOT filtered here by
 * default (unlike the leaderboard) — a public caller still narrows it via
 * `RecordRoomScope.rankedOnly`.
 */
export type RecordRoomScope = {
  /**
   * Restrict to these categories (the caller's jurisdiction-visible set). An
   * EMPTY array means nothing is visible and short-circuits to an empty page;
   * omitting the field is the unfiltered admin view.
   */
  categories?: readonly string[]
  /**
   * Public callers see the ranked league's own history only. On-demand rounds
   * are operator/ad-hoc runs (arbitrary propositions on arbitrary symbols);
   * they are legitimately part of the admin log but are not the "proof of
   * fairness" record for the ranked league.
   */
  rankedOnly?: boolean
}

export async function fetchRecordRoomPage(
  page: number,
  pageSize: number,
  scope?: RecordRoomScope
): Promise<RecordRoomPage> {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
  const safePageSize = Number.isFinite(pageSize) && pageSize >= 1
    ? Math.min(Math.floor(pageSize), RECORD_ROOM_MAX_PAGE_SIZE)
    : RECORD_ROOM_DEFAULT_PAGE_SIZE

  if (scope?.categories && scope.categories.length === 0) {
    return buildRecordRoomPage([], [], safePage, safePageSize, 0)
  }

  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  let roundsQuery = supabaseAdmin
    .from('prediction_rounds')
    .select(ROUND_COLUMNS, { count: 'exact' })
    .not('resolved_at', 'is', null)

  if (scope?.categories) roundsQuery = roundsQuery.in('category', scope.categories as string[])
  if (scope?.rankedOnly) roundsQuery = roundsQuery.eq('item_type', 'ranked')

  const { data: roundRows, error: roundsError, count } = await roundsQuery
    .order('resolved_at', { ascending: false })
    .range(from, to)

  if (roundsError) throw new Error(`league record room: rounds query failed (${roundsError.message})`)

  const rounds = (roundRows ?? []) as RecordRoomRoundRow[]
  const roundIds = rounds.map((r) => r.id)

  let predictions: RecordRoomPredictionRow[] = []
  if (roundIds.length > 0) {
    const { data: predictionRows, error: predictionsError } = await supabaseAdmin
      .from('model_predictions')
      .select(PREDICTION_COLUMNS)
      .in('round_id', roundIds)
    if (predictionsError) throw new Error(`league record room: predictions query failed (${predictionsError.message})`)
    predictions = (predictionRows ?? []) as RecordRoomPredictionRow[]
  }

  return buildRecordRoomPage(rounds, predictions, safePage, safePageSize, count ?? 0)
}
