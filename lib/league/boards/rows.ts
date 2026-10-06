import { isExcludedGradedConsensusRound, isGradedNonVoidedRound } from '../graded-consensus-rounds'
import type { BoardPrediction, BoardRound } from './types'

/**
 * DB row → board row (pure). This is where public scope is decided: test
 * rounds, voided rounds, ungraded rounds and the operator-excluded legacy
 * same-day class never become a `BoardRound`, so no board can count them.
 */

export type RoundDbRow = {
  id: string
  category: string
  horizon: string
  instrument: string
  subject_label?: string | null
  resolves_at?: string | null
  resolved_at?: string | null
  actual_outcome?: string | null
  grading_status?: string | null
  is_test?: boolean | null
  consensus_is_correct?: boolean | null
  consensus_aggregate_probability?: number | string | null
  anchor_session_date?: string | null
  resolution_session_date?: string | null
}

export type PredictionDbRow = {
  round_id: string
  model_id: string
  league_tier: string | null
  camp: string | null
  brand: string | null
  predicted_direction: string | null
  predicted_value: number | string | null
  is_correct: boolean | null
  analysis_lens?: string | null
}

export function isBoardRound(row: RoundDbRow, opts: { includeTest?: boolean } = {}): boolean {
  if (row.is_test !== false && !opts.includeTest) return false
  if (!isGradedNonVoidedRound(row)) return false
  return !isExcludedGradedConsensusRound(row)
}

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function toBoardRound(row: RoundDbRow): BoardRound {
  return {
    id: row.id,
    category: row.category,
    horizon: row.horizon,
    label: row.subject_label?.trim() || row.instrument,
    resolvesAt: row.resolves_at || row.resolved_at || '',
    consensusCorrect: typeof row.consensus_is_correct === 'boolean' ? row.consensus_is_correct : null,
    consensusProbability: num(row.consensus_aggregate_probability),
  }
}

export function toBoardPrediction(row: PredictionDbRow): BoardPrediction | null {
  if (typeof row.is_correct !== 'boolean') return null
  return {
    roundId: row.round_id,
    modelId: row.model_id,
    tier: row.league_tier ?? '',
    camp: row.camp ?? '',
    brand: row.brand ?? '',
    side: row.predicted_direction ?? null,
    probability: num(row.predicted_value),
    correct: row.is_correct,
    lens: row.analysis_lens?.trim() || null,
  }
}
