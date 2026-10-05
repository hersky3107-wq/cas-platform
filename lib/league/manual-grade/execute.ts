import 'server-only'

import { addCreditsBalance } from '@/lib/credits-server'
import { planForRound } from '@/lib/league/gateway/plan-for-round'
import {
  listChargedUnrefundedForRound,
  markJobRefundedOnce,
} from '@/lib/league/generation/job-store'
import { supabaseAdmin } from '@/lib/supabase/server'
import { supabaseGradingStore } from '@/lib/prediction/reconciliation'
import { stampConsensusIsCorrect } from '@/lib/league/consensus-correctness'
import {
  directionForVerdict,
  formatManualOutcome,
  isManualVerdict,
  LEAGUE_VOID_REFUND_MODULE,
  VOID_UNRESOLVABLE_REASON,
  type BulkGradeItem,
  type ManualGradeInput,
  type ManualVerdict,
} from './types'

export type ManualGradeResult =
  | { ok: true; verdict: ManualVerdict; children_graded: number; refunded_credits: number }
  | { ok: false; error: string; status: number }

export async function applyManualGrade(input: ManualGradeInput): Promise<ManualGradeResult> {
  if (!isManualVerdict(input.verdict)) {
    return { ok: false, error: 'verdict must be yes, no, or void', status: 400 }
  }

  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, category, proposition_kind, actual_outcome, grading_status, resolves_at')
    .eq('id', input.roundId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message, status: 500 }
  if (!data) return { ok: false, error: 'round not found', status: 404 }
  if (data.actual_outcome !== null || data.grading_status === 'graded') {
    return { ok: false, error: 'already graded', status: 409 }
  }
  if (data.grading_status === 'voided') {
    return { ok: false, error: 'already voided', status: 409 }
  }

  const plan = planForRound(String(data.instrument), String(data.category))
  if (plan.source === 'price_series' || plan.source === 'lmarena' || plan.source === 'kobis') {
    return { ok: false, error: 'auto-graded rounds refuse manual overwrite', status: 400 }
  }

  const nowIso = new Date().toISOString()
  const evidenceUrl = (input.evidenceUrl ?? '').trim()
  const note = (input.note ?? '').trim()

  if (input.verdict === 'void') {
    return voidRound({
      roundId: input.roundId,
      gradedBy: input.gradedBy,
      evidenceUrl,
      note,
      nowIso,
    })
  }

  const direction = directionForVerdict(input.verdict)
  const actualOutcome = formatManualOutcome({
    propositionKind: data.proposition_kind,
    verdict: input.verdict,
    evidenceUrl,
    note,
  })

  // Children first (same order as auto grading): a reader must never see a
  // graded round with unstamped tiles.
  const childrenGraded = await supabaseGradingStore.gradeChildren(input.roundId, direction)

  const { data: saved, error: saveError } = await supabaseAdmin
    .from('prediction_rounds')
    .update({
      actual_outcome: actualOutcome,
      resolved_at: nowIso,
      grading_status: 'graded',
      graded_by: input.gradedBy,
      graded_evidence_url: evidenceUrl || null,
      graded_note: note || null,
      unresolvable_reason: null,
      unresolvable_detail: null,
      grading_busy_until: null,
    })
    .eq('id', input.roundId)
    .is('actual_outcome', null)
    .neq('grading_status', 'voided')
    .select('id')
  if (saveError) return { ok: false, error: saveError.message, status: 500 }
  if (!saved || saved.length === 0) {
    return { ok: false, error: 'round was graded by another pass', status: 409 }
  }

  await stampConsensusIsCorrect(input.roundId).catch((e: unknown) => {
    console.warn(
      `[manual-grade] round ${input.roundId} consensus_is_correct not stamped: ${e instanceof Error ? e.message : e}`,
    )
  })

  return { ok: true, verdict: input.verdict, children_graded: childrenGraded, refunded_credits: 0 }
}

async function voidRound(args: {
  roundId: string
  gradedBy: string
  evidenceUrl: string
  note: string
  nowIso: string
}): Promise<ManualGradeResult> {
  const note = args.note.trim() || 'REFUND: round voided'
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .update({
      grading_status: 'voided',
      graded_by: args.gradedBy,
      graded_evidence_url: args.evidenceUrl || null,
      graded_note: note,
      unresolvable_reason: VOID_UNRESOLVABLE_REASON,
      unresolvable_detail: note.slice(0, 500),
      grading_attempted_at: args.nowIso,
      grading_busy_until: null,
      // Leave actual_outcome AND resolved_at null. gradingStateOf treats
      // either as 'graded', which would put a voided round in the leaderboard
      // denominator. Unresolvable coverage + is_correct NULL is the contract.
    })
    .eq('id', args.roundId)
    .is('actual_outcome', null)
    .neq('grading_status', 'voided')
    .neq('grading_status', 'graded')
    .select('id')
  if (error) return { ok: false, error: error.message, status: 500 }
  if (!data || data.length === 0) {
    return { ok: false, error: 'round was graded or voided by another pass', status: 409 }
  }

  const refunded = await refundChargedJobs(args.roundId)
  return { ok: true, verdict: 'void', children_graded: 0, refunded_credits: refunded }
}

async function refundChargedJobs(roundId: string): Promise<number> {
  const jobs = await listChargedUnrefundedForRound(roundId)
  let total = 0
  for (const job of jobs) {
    if (!job.user_id || job.charged_cost < 1 || job.deduct_skipped) {
      await markJobRefundedOnce(job.id)
      continue
    }
    const won = await markJobRefundedOnce(job.id)
    if (!won) continue
    const grant = await addCreditsBalance(supabaseAdmin, job.user_id, job.charged_cost)
    if (grant.ok && typeof grant.balance === 'number') {
      total += job.charged_cost
      const before = grant.balance - job.charged_cost
      await supabaseAdmin.from('credit_logs').insert({
        user_id: job.user_id,
        module: LEAGUE_VOID_REFUND_MODULE,
        amount: job.charged_cost,
        balance_before: before,
        balance_after: grant.balance,
      })
    }
  }
  return total
}

export async function applyManualGradesBulk(
  items: readonly BulkGradeItem[],
  gradedBy: string
): Promise<{ ok: true; results: Array<ManualGradeResult & { roundId: string }> }> {
  const results: Array<ManualGradeResult & { roundId: string }> = []
  for (const item of items) {
    const result = await applyManualGrade({
      roundId: item.roundId,
      verdict: item.verdict,
      gradedBy,
      evidenceUrl: item.evidenceUrl,
      note: item.note,
    })
    results.push({ ...result, roundId: item.roundId })
  }
  return { ok: true, results }
}
