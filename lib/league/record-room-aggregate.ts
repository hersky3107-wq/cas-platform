import type { Camp, ColorBucket, Direction, LeagueTier } from './card-types'

/**
 * AI Prediction League — RECORD ROOM aggregation (read-only).
 *
 * `resolved rounds + their model_predictions -> paginated log entries`,
 * assembled exactly once here (mirrors `card-aggregate.ts` /
 * `leaderboard-aggregate.ts`: pure data-in/data-out, no I/O, unit-testable —
 * see `lib/league/record-room.ts` for the paginated DB read path).
 *
 * This is the public proof-of-fairness view: an immutable, timestamped list
 * of rounds that have already resolved, with the actual outcome and every
 * model's directional call + correct/incorrect grade. It is intentionally
 * NOT filtered to `item_type = 'ranked'` the way the leaderboard is — that
 * exclusion exists to protect RANKING integrity (an ad-hoc on-demand round
 * must not move a model's win rate), which is a different concern from
 * "did this round resolve and what happened" record-keeping. A resolved
 * on-demand round is still a real, timestamped prediction and belongs in the
 * record room.
 */

export type RecordRoomModelEntry = {
  model_id: string
  brand: string
  camp: Camp
  league_tier: LeagueTier
  direction: Direction | null
  /** null = ungraded (e.g. scout tier, or abstained) even though the round resolved. */
  is_correct: boolean | null
}

export type RecordRoomRoundEntry = {
  round_id: string
  proposition_text: string
  category: string
  instrument: string
  color_bucket: ColorBucket
  resolved_at: string
  actual_outcome: string | null
  models: RecordRoomModelEntry[]
  /** Count of `models` with `is_correct !== null`. */
  gradedCount: number
  /** Count of `models` with `is_correct === true`. */
  correctCount: number
}

export type RecordRoomPage = {
  rounds: RecordRoomRoundEntry[]
  page: number
  pageSize: number
  totalRounds: number
  totalPages: number
  generatedAt: string
}

export type RecordRoomRoundRow = {
  id: string
  proposition_text: string
  category: string
  color_bucket: string
  instrument: string
  resolved_at: string
  actual_outcome: string | null
}

export type RecordRoomPredictionRow = {
  round_id: string
  model_id: string
  brand: string
  camp: string
  league_tier: string
  predicted_direction: string | null
  is_correct: boolean | null
}

function toDirection(raw: string | null): Direction | null {
  return raw === 'up' || raw === 'down' || raw === 'flat' ? raw : null
}

function toColorBucket(raw: string): ColorBucket {
  return raw === 'green' || raw === 'yellow' || raw === 'red' ? raw : 'yellow'
}

function toModelEntry(row: RecordRoomPredictionRow): RecordRoomModelEntry {
  return {
    model_id: row.model_id,
    brand: row.brand,
    camp: row.camp as Camp,
    league_tier: row.league_tier as LeagueTier,
    direction: toDirection(row.predicted_direction),
    is_correct: row.is_correct,
  }
}

/** Pure assembly: one page of round rows + all their predictions -> `RecordRoomRoundEntry[]`, in the same order as `roundRows`. */
export function buildRecordRoomEntries(
  roundRows: readonly RecordRoomRoundRow[],
  predictionRows: readonly RecordRoomPredictionRow[]
): RecordRoomRoundEntry[] {
  const byRound = new Map<string, RecordRoomPredictionRow[]>()
  for (const p of predictionRows) {
    const list = byRound.get(p.round_id) ?? []
    list.push(p)
    byRound.set(p.round_id, list)
  }

  return roundRows.map((round) => {
    const models = (byRound.get(round.id) ?? []).map(toModelEntry)
    const graded = models.filter((m) => m.is_correct !== null)
    return {
      round_id: round.id,
      proposition_text: round.proposition_text,
      category: round.category,
      instrument: round.instrument,
      color_bucket: toColorBucket(round.color_bucket),
      resolved_at: round.resolved_at,
      actual_outcome: round.actual_outcome,
      models,
      gradedCount: graded.length,
      correctCount: graded.filter((m) => m.is_correct === true).length,
    }
  })
}

/** Assembles the full paginated response shape from a page of rounds + their predictions + the total count. */
export function buildRecordRoomPage(
  roundRows: readonly RecordRoomRoundRow[],
  predictionRows: readonly RecordRoomPredictionRow[],
  page: number,
  pageSize: number,
  totalRounds: number
): RecordRoomPage {
  return {
    rounds: buildRecordRoomEntries(roundRows, predictionRows),
    page,
    pageSize,
    totalRounds,
    totalPages: totalRounds > 0 ? Math.ceil(totalRounds / pageSize) : 0,
    generatedAt: new Date().toISOString(),
  }
}
