/**
 * Shared filter for admin track record and 복기 lesson notes.
 * Sample = resolved, non-voided rounds with a stamped AI 종합 pick.
 * Legacy same-day exclusion applies only to the 24h spot class (see legacy-same-day-24h).
 */

import { isLegacySameDay24hRound, type LegacySameDay24hRow } from './legacy-same-day-24h'

export type GradedConsensusRoundRow = {
  id?: string
  category: string
  horizon: string
  instrument: string
  grading_status?: string | null
  actual_outcome?: string | null
  consensus_is_correct?: boolean | null
  anchor_session_date?: string | null
  resolution_session_date?: string | null
  unresolvable_reason?: string | null
  opened_at?: string | null
}

export function hasResolvedOutcome(row: Pick<GradedConsensusRoundRow, 'actual_outcome'>): boolean {
  return String(row.actual_outcome ?? '').trim() !== ''
}

export function isVoidedRound(row: Pick<GradedConsensusRoundRow, 'grading_status'>): boolean {
  return row.grading_status === 'voided'
}

/** Resolved and not voided (`grading_status` may be `graded`, legacy `auto`, etc.). */
export function isGradedNonVoidedRound(row: GradedConsensusRoundRow): boolean {
  return !isVoidedRound(row) && hasResolvedOutcome(row)
}

export function hasConsensusPick(row: Pick<GradedConsensusRoundRow, 'consensus_is_correct'>): boolean {
  return row.consensus_is_correct !== null && row.consensus_is_correct !== undefined
}

export function isExcludedGradedConsensusRound(row: GradedConsensusRoundRow): boolean {
  if (isVoidedRound(row)) return true
  return isLegacySameDay24hRound(row as LegacySameDay24hRow)
}

/** Human-readable reason when admin counts a round but lesson notes would not (for diagnostics). */
export function gradedConsensusExclusionReason(row: GradedConsensusRoundRow): string | null {
  if (!hasResolvedOutcome(row)) return 'missing actual_outcome'
  if (isVoidedRound(row)) return 'grading_status voided'
  if (!hasConsensusPick(row)) return 'consensus_is_correct null (no AI 종합 pick)'
  if (isLegacySameDay24hRound(row as LegacySameDay24hRow)) return 'legacy same-day 24h 1d class'
  return null
}

export function isGradedConsensusTrackRound(row: GradedConsensusRoundRow): boolean {
  if (!isGradedNonVoidedRound(row)) return false
  if (!hasConsensusPick(row)) return false
  if (isExcludedGradedConsensusRound(row)) return false
  return true
}

export function selectGradedConsensusTrackRounds<T extends GradedConsensusRoundRow>(rows: readonly T[]): T[] {
  return rows.filter(isGradedConsensusTrackRound)
}

export type TrackRecordCellCounts = {
  consensusHits: number
  consensusN: number
}

export function consensusHitsForCell(rows: readonly GradedConsensusRoundRow[]): TrackRecordCellCounts {
  const track = selectGradedConsensusTrackRounds(rows)
  let consensusHits = 0
  for (const row of track) {
    if (row.consensus_is_correct) consensusHits += 1
  }
  return { consensusHits, consensusN: track.length }
}
