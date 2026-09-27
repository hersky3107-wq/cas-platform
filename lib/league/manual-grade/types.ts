/**
 * Manual admin grading — shared foundation for freeform league categories.
 *
 * Price categories never enter this module. Sports / politics / entertainment
 * / real-estate (non-price) / tech wait here for an admin YES / NO / VOID.
 * Pure: no I/O, so vitest covers the mapping without a database.
 */

import { gradedSidesFor } from '@/lib/prediction/graded-sides'
import type { ResolutionDirection } from '@/lib/prediction/resolution'
import { LEAGUE_VOID_REFUND_MODULE } from '@/lib/league/credits'

export { LEAGUE_VOID_REFUND_MODULE }

export const MANUAL_GRADING_STATUSES = ['auto', 'needs_grading', 'graded', 'voided'] as const
export type ManualGradingStatus = (typeof MANUAL_GRADING_STATUSES)[number]

export const MANUAL_VERDICTS = ['yes', 'no', 'void'] as const
export type ManualVerdict = (typeof MANUAL_VERDICTS)[number]

export const VOID_UNRESOLVABLE_REASON = 'event_voided'

/** Engine binary: YES (named subject achieved it) = side A = 'up'. */
export function directionForVerdict(verdict: Exclude<ManualVerdict, 'void'>): ResolutionDirection {
  return verdict === 'yes' ? 'up' : 'down'
}

export function isManualVerdict(raw: unknown): raw is ManualVerdict {
  return raw === 'yes' || raw === 'no' || raw === 'void'
}

export function formatManualOutcome(args: {
  propositionKind: unknown
  verdict: Exclude<ManualVerdict, 'void'>
  evidenceUrl: string
  note: string
}): string {
  const direction = directionForVerdict(args.verdict)
  const { winner } = gradedSidesFor(args.propositionKind, direction)
  const bits: string[] = [winner]
  const note = args.note.trim()
  if (note) bits.push(note)
  const url = args.evidenceUrl.trim()
  if (url) bits.push(url)
  return bits.join(' · ').slice(0, 500)
}

export type ManualQueueItem = {
  id: string
  proposition_text: string
  resolution_rule: string
  category: string
  instrument: string
  horizon: string
  proposition_kind: string | null
  subject_label: string | null
  resolves_at: string
  created_at: string | null
  creator_user_id: string | null
  charged_credits: number
  side_a: string
  side_b: string
}

export type ManualSuggestion = {
  verdict: ManualVerdict | 'unknown'
  confidence: number
  summary: string
  source_url: string | null
}

function clampSuggestionConfidence(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  if (n > 1 && n <= 100) return Math.round(n) / 100
  return Math.min(1, Math.max(0, n))
}

export function parseSuggestionPayload(raw: unknown): ManualSuggestion {
  if (!raw || typeof raw !== 'object') {
    return { verdict: 'unknown', confidence: 0, summary: '', source_url: null }
  }
  const obj = raw as Record<string, unknown>
  const verdictRaw = typeof obj.verdict === 'string' ? obj.verdict.trim().toLowerCase() : ''
  const verdict: ManualVerdict | 'unknown' = isManualVerdict(verdictRaw) ? verdictRaw : 'unknown'
  const summary = typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 400) : ''
  const url = typeof obj.source_url === 'string' && obj.source_url.startsWith('https://') ? obj.source_url.trim() : null
  return { verdict, confidence: clampSuggestionConfidence(obj.confidence), summary, source_url: url }
}

export type ManualGradeInput = {
  roundId: string
  verdict: ManualVerdict
  gradedBy: string
  evidenceUrl?: string
  note?: string
}

export type BulkGradeItem = {
  roundId: string
  verdict: ManualVerdict
  evidenceUrl?: string
  note?: string
}
