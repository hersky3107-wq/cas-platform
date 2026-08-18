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
 * writes, never touches scoring/cron/reconciliation.
 *
 * The FREE vs DEEP split is enforced by the API routes (this module only
 * fetches what it is asked for). Public callers still narrow via
 * `RecordRoomScope.rankedOnly`.
 */
export type RecordRoomScope = {
  categories?: readonly string[]
  rankedOnly?: boolean
  modelId?: string
  from?: string
  to?: string
  deep?: boolean
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
    return buildRecordRoomPage([], [], safePage, safePageSize, 0, scope.deep === true)
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
      return buildRecordRoomPage([], [], safePage, safePageSize, 0, scope.deep === true)
    }
  }

  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  let roundsQuery = supabaseAdmin
    .from('prediction_rounds')
    .select(ROUND_COLUMNS, { count: 'exact' })
    .not('resolved_at', 'is', null)

  if (scope?.categories) roundsQuery = roundsQuery.in('category', scope.categories as string[])
  if (scope?.rankedOnly) roundsQuery = roundsQuery.eq('item_type', 'ranked')
  if (modelRoundIds) roundsQuery = roundsQuery.in('id', modelRoundIds)
  if (scope?.from?.trim()) roundsQuery = roundsQuery.gte('resolved_at', scope.from.trim())
  if (scope?.to?.trim()) roundsQuery = roundsQuery.lte('resolved_at', scope.to.trim())

  const { data: roundRows, error: roundsError, count } = await roundsQuery
    .order('resolved_at', { ascending: false })
    .range(from, to)

  if (roundsError) throw new Error(`league record room: rounds query failed (${roundsError.message})`)

  const rounds = (roundRows ?? []) as RecordRoomRoundRow[]
  const roundIds = rounds.map((r) => r.id)

  let predictions: RecordRoomPredictionRow[] = []
  if (roundIds.length > 0) {
    let predQuery = supabaseAdmin.from('model_predictions').select(PREDICTION_COLUMNS).in('round_id', roundIds)
    if (scope?.modelId?.trim()) predQuery = predQuery.eq('model_id', scope.modelId.trim())
    const { data: predictionRows, error: predictionsError } = await predQuery
    if (predictionsError) throw new Error(`league record room: predictions query failed (${predictionsError.message})`)
    predictions = (predictionRows ?? []) as RecordRoomPredictionRow[]
  }

  return buildRecordRoomPage(rounds, predictions, safePage, safePageSize, count ?? 0, scope?.deep === true)
}

/** Flatten a record-room page into CSV (deep-archive export only). */
export function recordRoomToCsv(page: RecordRoomPage): string {
  const header = [
    'resolved_at',
    'instrument',
    'category',
    'proposition',
    'actual_outcome',
    'model_id',
    'brand',
    'camp',
    'league_tier',
    'direction',
    'is_correct',
  ]
  const lines = [header.join(',')]
  for (const round of page.rounds) {
    if (round.models.length === 0) {
      lines.push(
        [
          csv(round.resolved_at),
          csv(round.instrument),
          csv(round.category),
          csv(round.proposition_text),
          csv(round.actual_outcome),
          '',
          '',
          '',
          '',
          '',
          '',
        ].join(',')
      )
      continue
    }
    for (const model of round.models) {
      lines.push(
        [
          csv(round.resolved_at),
          csv(round.instrument),
          csv(round.category),
          csv(round.proposition_text),
          csv(round.actual_outcome),
          csv(model.model_id),
          csv(model.brand),
          csv(model.camp),
          csv(model.league_tier),
          csv(model.direction),
          model.is_correct === null ? '' : model.is_correct ? 'true' : 'false',
        ].join(',')
      )
    }
  }
  return `${lines.join('\n')}\n`
}

function csv(value: string | null | undefined): string {
  const raw = value ?? ''
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`
  return raw
}
