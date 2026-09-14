import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { gradeDueRoundsInBackground } from '@/lib/prediction/reconciliation'
import {
  buildRecordRoomPage,
  type RecordRoomPage,
  type RecordRoomPredictionRow,
  type RecordRoomRoundRow,
} from './record-room-aggregate'
import { recordRoomToCsv } from './record-room-csv'

export { buildRecordRoomPage, recordRoomToCsv }
export type { RecordRoomPage }

export const RECORD_ROOM_DEFAULT_PAGE_SIZE = 20
export const RECORD_ROOM_MAX_PAGE_SIZE = 50

const ROUND_COLUMNS = 'id, proposition_text, category, color_bucket, instrument, resolved_at, actual_outcome, item_type'
// The audit-sentence columns (and the 20260829000002 contract columns) live
// behind migrations that may not be applied to every environment (same caution
// as `lib/league/card.ts`'s optional columns). We ask for them, and fall back
// to the base set if the DB rejects the select — a not-yet-migrated env just
// renders the record room without the resolved window (and as all-price
// rounds, which is what a pre-migration DB only contains), never a broken page.
const ROUND_COLUMNS_WITH_AUDIT =
  `${ROUND_COLUMNS}, anchor_price, anchor_session_date, resolution_session_date, resolution_price, proposition_kind, subject_label`

function isMissingColumnError(message: string): boolean {
  return /does not exist|schema cache/i.test(message)
}
const PREDICTION_COLUMNS = 'round_id, model_id, brand, camp, league_tier, predicted_direction, is_correct'

/**
 * AI Prediction League — RECORD ROOM, DB read path.
 *
 * Paginated by `resolved_at` descending (most recently resolved first). Two
 * queries per page: (1) the page of resolved rounds + a total count, (2)
 * every model_predictions row for just those rounds.
 *
 * The page itself is assembled read-only, but reading it TRIGGERS grading for
 * every due, ungraded round (fire-and-forget — see `gradeDueRoundsInBackground`).
 * That is the point: this page's whole job is showing the track record, so a
 * round that is due and ungraded is a hole in it.
 *
 * Window clipping is enforced by the API routes (this module only fetches
 * what it is asked for). `rankedOnly` remains available for operators who
 * want a ranked-only slice; public paid listings pass an explicit
 * `windowRoundIds` list so a purchase cannot walk past its 30-round freeze.
 */
export type RecordRoomScope = {
  categories?: readonly string[]
  rankedOnly?: boolean
  modelId?: string
  from?: string
  to?: string
  deep?: boolean
  /** When set, the listing is restricted to these ids (purchased window). */
  windowRoundIds?: readonly string[]
  window?: { asOf: string; roundLimit: number }
}

export async function fetchRecordRoomPage(
  page: number,
  pageSize: number,
  scope?: RecordRoomScope
): Promise<RecordRoomPage> {
  // GRADE-ON-READ, list edition. The record room only ever DISPLAYS graded
  // rounds, so a due-but-ungraded round is exactly what is missing from this
  // page — reading it is what triggers grading for every such round. Started and
  // abandoned: the reader waits for nothing and sees the results next load.
  // Same claim/throttle rules as the card path, so simultaneous readers cannot
  // double-grade and an unresolvable round is not retried on every page view.
  void gradeDueRoundsInBackground()

  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
  const safePageSize = Number.isFinite(pageSize) && pageSize >= 1
    ? Math.min(Math.floor(pageSize), RECORD_ROOM_MAX_PAGE_SIZE)
    : RECORD_ROOM_DEFAULT_PAGE_SIZE

  if (scope?.categories && scope.categories.length === 0) {
    return buildRecordRoomPage([], [], safePage, safePageSize, 0, scope.deep === true, scope.window)
  }

  if (scope?.windowRoundIds && scope.windowRoundIds.length === 0) {
    return buildRecordRoomPage([], [], safePage, safePageSize, 0, scope.deep === true, scope.window)
  }

  let modelRoundIds: string[] | null = null
  if (scope?.modelId?.trim()) {
    const { data: modelRows, error: modelErr } = await supabaseAdmin
      .from('model_predictions')
      .select('round_id')
      .eq('model_id', scope.modelId.trim())
    if (modelErr) throw new Error(`league record room: model filter failed (${modelErr.message})`)
    modelRoundIds = Array.from(new Set((modelRows ?? []).map((r) => r.round_id as string)))
    if (modelRoundIds.length === 0) {
      return buildRecordRoomPage([], [], safePage, safePageSize, 0, scope.deep === true, scope.window)
    }
  }

  let restrictIds: string[] | null = scope?.windowRoundIds ? [...scope.windowRoundIds] : modelRoundIds
  if (scope?.windowRoundIds && modelRoundIds) {
    restrictIds = scope.windowRoundIds.filter((id) => modelRoundIds!.includes(id))
  }
  if (restrictIds && restrictIds.length === 0) {
    return buildRecordRoomPage([], [], safePage, safePageSize, 0, scope?.deep === true, scope?.window)
  }

  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  const runRoundsQuery = async (columns: string) => {
    let roundsQuery = supabaseAdmin
      .from('prediction_rounds')
      .select(columns, { count: 'exact' })
      .not('resolved_at', 'is', null)

    if (scope?.categories) roundsQuery = roundsQuery.in('category', scope.categories as string[])
    if (scope?.rankedOnly) roundsQuery = roundsQuery.eq('item_type', 'ranked')
    if (restrictIds) roundsQuery = roundsQuery.in('id', restrictIds)
    if (scope?.from?.trim()) roundsQuery = roundsQuery.gte('resolved_at', scope.from.trim())
    if (scope?.to?.trim()) roundsQuery = roundsQuery.lte('resolved_at', scope.to.trim())

    return roundsQuery.order('resolved_at', { ascending: false }).range(from, to)
  }

  let { data: roundRows, error: roundsError, count } = await runRoundsQuery(ROUND_COLUMNS_WITH_AUDIT)
  if (roundsError && isMissingColumnError(roundsError.message)) {
    ;({ data: roundRows, error: roundsError, count } = await runRoundsQuery(ROUND_COLUMNS))
  }

  if (roundsError) throw new Error(`league record room: rounds query failed (${roundsError.message})`)

  const rounds = (roundRows ?? []) as unknown as RecordRoomRoundRow[]
  const roundIds = rounds.map((r) => r.id)

  let predictions: RecordRoomPredictionRow[] = []
  if (roundIds.length > 0) {
    let predQuery = supabaseAdmin.from('model_predictions').select(PREDICTION_COLUMNS).in('round_id', roundIds)
    if (scope?.modelId?.trim()) predQuery = predQuery.eq('model_id', scope.modelId.trim())
    const { data: predictionRows, error: predictionsError } = await predQuery
    if (predictionsError) throw new Error(`league record room: predictions query failed (${predictionsError.message})`)
    predictions = (predictionRows ?? []) as RecordRoomPredictionRow[]
  }

  return buildRecordRoomPage(
    rounds,
    predictions,
    safePage,
    safePageSize,
    count ?? 0,
    scope?.deep === true,
    scope?.window
  )
}

/**
 * The 30 (or `limit`) most recently resolved rounds at or before `asOf`.
 * This is the frozen record-room window one purchase buys.
 */
export async function listRecentResolvedRoundIds(params: {
  asOf: string
  limit: number
  categories?: readonly string[]
}): Promise<string[]> {
  if (params.categories && params.categories.length === 0) return []
  let query = supabaseAdmin
    .from('prediction_rounds')
    .select('id')
    .not('resolved_at', 'is', null)
    .lte('resolved_at', params.asOf)
    .order('resolved_at', { ascending: false })
    .limit(params.limit)
  if (params.categories) query = query.in('category', params.categories as string[])
  const { data, error } = await query
  if (error) throw new Error(`league record room: window ids failed (${error.message})`)
  return (data ?? []).map((row) => row.id as string)
}
