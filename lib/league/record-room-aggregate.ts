import type { Camp, ColorBucket, LeagueTier, ModelSide } from './card-types'
import { roundHitRecord } from './round-hit'
import { toSideToken } from './side-labels'
import { normalizeSessionDate } from '../prediction/resolution'

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
 * model's directional call + correct/incorrect grade. Creation mode
 * (`item_type`) is kept as provenance and shown on each entry; both ranked
 * and on_demand graded rounds belong here once they resolve.
 */

export type RecordRoomModelEntry = {
  model_id: string
  brand: string
  camp: Camp
  league_tier: LeagueTier
  /** The row's own side token (up/down/yes/no/above/below) or legacy 'flat'; rendered via the round's side labels. */
  direction: ModelSide | null
  /** null = ungraded (abstained / parse failure) even though the round resolved. */
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
  /** Answer contract of the round — drives every side word/glyph on the entry via `lib/league/side-labels.ts`. */
  proposition_kind: string
  subject_label: string | null
  /** Provenance: how the round was opened. Not a quality tier. */
  item_type: 'ranked' | 'on_demand' | null
  /**
   * Audit fields the resolved-window sentence is built from — the SAME source
   * as the card header (see `lib/league/card-header-copy.ts`'s `headerWindow`).
   * The record room renders these, never the date embedded in `actual_outcome`,
   * so the two surfaces can never disagree. Null where a session was never
   * recorded; the renderer blanks rather than inventing a date.
   */
  anchorPrice: number | null
  anchorSessionDate: string | null
  resolutionSessionDate: string | null
  resolutionPrice: number | null
  models: RecordRoomModelEntry[]
  /** Count of `models` with `is_correct !== null`. */
  gradedCount: number
  /** Count of `models` with `is_correct === true`. */
  correctCount: number
}

export type RecordRoomHeadline = {
  latestInstrument: string | null
  latestOutcome: string | null
  latestResolvedAt: string | null
  /** Latest round's contract — the headline window sentence is price-only, so the renderer needs the kind. */
  latestPropositionKind: string | null
  /** Latest round's audit fields, for the same window sentence the per-row entry uses. */
  latestAnchorPrice: number | null
  latestAnchorSessionDate: string | null
  latestResolutionSessionDate: string | null
  latestResolutionPrice: number | null
  recentGraded: number
  recentCorrect: number
}

export type RecordRoomPage = {
  rounds: RecordRoomRoundEntry[]
  page: number
  pageSize: number
  totalRounds: number
  totalPages: number
  generatedAt: string
  /** Recent-results headline for the free summary view. */
  headline: RecordRoomHeadline
  /** true when this payload came from the paid deep-archive path. */
  deep: boolean
}

export type RecordRoomRoundRow = {
  id: string
  proposition_text: string
  category: string
  color_bucket: string
  instrument: string
  resolved_at: string
  actual_outcome: string | null
  item_type?: string | null
  /** Optional like the audit columns: absent pre-20260829000002 = close_higher. */
  proposition_kind?: string | null
  subject_label?: string | null
  anchor_price?: number | null
  anchor_session_date?: string | null
  resolution_session_date?: string | null
  resolution_price?: number | null
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

function toColorBucket(raw: string): ColorBucket {
  return raw === 'green' || raw === 'yellow' || raw === 'red' ? raw : 'yellow'
}

function toModelEntry(row: RecordRoomPredictionRow): RecordRoomModelEntry {
  return {
    model_id: row.model_id,
    brand: row.brand,
    camp: row.camp as Camp,
    league_tier: row.league_tier as LeagueTier,
    // toSideToken, not the old up/down/flat gate: yes/no/above/below rows are
    // real calls in the log, never blanks.
    direction: toSideToken(row.predicted_direction),
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
    const hit = roundHitRecord(models)
    return {
      round_id: round.id,
      proposition_text: round.proposition_text,
      category: round.category,
      instrument: round.instrument,
      color_bucket: toColorBucket(round.color_bucket),
      resolved_at: round.resolved_at,
      actual_outcome: round.actual_outcome,
      proposition_kind: round.proposition_kind ?? 'binary_close_higher',
      subject_label: round.subject_label ?? null,
      item_type: round.item_type === 'on_demand' || round.item_type === 'ranked' ? round.item_type : null,
      anchorPrice: round.anchor_price ?? null,
      anchorSessionDate: normalizeSessionDate(round.anchor_session_date ?? null),
      resolutionSessionDate: normalizeSessionDate(round.resolution_session_date ?? null),
      resolutionPrice: round.resolution_price ?? null,
      models,
      gradedCount: hit.graded,
      correctCount: hit.correct,
    }
  })
}

export function buildRecordRoomHeadline(rounds: readonly RecordRoomRoundEntry[]): RecordRoomHeadline {
  const latest = rounds[0]
  let recentGraded = 0
  let recentCorrect = 0
  for (const r of rounds) {
    recentGraded += r.gradedCount
    recentCorrect += r.correctCount
  }
  return {
    latestInstrument: latest?.instrument ?? null,
    latestOutcome: latest?.actual_outcome ?? null,
    latestResolvedAt: latest?.resolved_at ?? null,
    latestPropositionKind: latest?.proposition_kind ?? null,
    latestAnchorPrice: latest?.anchorPrice ?? null,
    latestAnchorSessionDate: latest?.anchorSessionDate ?? null,
    latestResolutionSessionDate: latest?.resolutionSessionDate ?? null,
    latestResolutionPrice: latest?.resolutionPrice ?? null,
    recentGraded,
    recentCorrect,
  }
}

/** Assembles the full paginated response shape from a page of rounds + their predictions + the total count. */
export function buildRecordRoomPage(
  roundRows: readonly RecordRoomRoundRow[],
  predictionRows: readonly RecordRoomPredictionRow[],
  page: number,
  pageSize: number,
  totalRounds: number,
  deep = false
): RecordRoomPage {
  const rounds = buildRecordRoomEntries(roundRows, predictionRows)
  return {
    rounds,
    page,
    pageSize,
    totalRounds,
    totalPages: totalRounds > 0 ? Math.ceil(totalRounds / pageSize) : 0,
    generatedAt: new Date().toISOString(),
    headline: buildRecordRoomHeadline(rounds),
    deep,
  }
}
