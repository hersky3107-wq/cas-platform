import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { planForRound } from '@/lib/league/gateway/plan-for-round'
import { supabaseGradingStore } from './reconciliation'
import {
  gradeFromOperatorEvidence,
  type OperatorEvidenceRow,
  type OperatorGradeDeps,
  type OperatorGradeInput,
  type OperatorGradeResult,
  type OperatorRoundRow,
} from './operator-grade'

export type { OperatorGradeResult }

export const liveOperatorGradeDeps: OperatorGradeDeps = {
  resolvePlan: planForRound,

  async loadRound(roundId) {
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .select('id, instrument, category, proposition_kind, subject_label, actual_outcome, resolved_at, resolves_at')
      .eq('id', roundId)
      .maybeSingle()
    if (error || !data) return null
    return data as OperatorRoundRow
  },

  async insertEvidence(row) {
    const { error } = await supabaseAdmin.from('prediction_round_grade_evidence').insert({
      round_id: row.roundId,
      source_url: row.sourceUrl,
      observed_fact: row.observedFact,
      derived_side: row.derivedSide,
      graded_by: row.gradedBy,
    })
    if (!error) return { ok: true }
    if (error.code === '23505') return { ok: false, unique: true, error: error.message }
    return { ok: false, unique: false, error: error.message }
  },

  async loadEvidence(roundId) {
    const { data, error } = await supabaseAdmin
      .from('prediction_round_grade_evidence')
      .select('source_url, observed_fact, derived_side')
      .eq('round_id', roundId)
      .maybeSingle()
    if (error || !data) return null
    return data as OperatorEvidenceRow
  },

  async saveOutcome(roundId, actualOutcome, nowIso) {
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .update({
        actual_outcome: actualOutcome,
        resolved_at: nowIso,
        unresolvable_reason: null,
        unresolvable_detail: null,
        grading_busy_until: null,
      })
      .eq('id', roundId)
      .is('actual_outcome', null)
      .select('id')
    if (error || !data || data.length === 0) return false
    return true
  },

  async gradeChildren(roundId, direction) {
    return supabaseGradingStore.gradeChildren(roundId, direction)
  },
}

export async function gradeRoundFromOperatorEvidence(input: OperatorGradeInput): Promise<OperatorGradeResult> {
  return gradeFromOperatorEvidence(input, liveOperatorGradeDeps)
}
