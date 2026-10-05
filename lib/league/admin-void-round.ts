/**
 * Admin void — dry-run by default. Sets grading_status voided, refunds
 * charged-unrefunded generation purchases via the existing void refund path.
 */
import 'server-only'

import { addCreditsBalance } from '@/lib/credits-server'
import { LEAGUE_VOID_REFUND_MODULE } from '@/lib/league/credits'
import {
  listChargedUnrefundedForRound,
  markJobRefundedOnce,
  type LeagueGenerationJob,
} from '@/lib/league/generation/job-store'
import { supabaseAdmin } from '@/lib/supabase/server'
import { scheduleLessonRefresh } from '@/lib/league/extra/lesson-refresh'
import { parseVoidRoundArgs, type VoidRoundArgs } from './void-round-args'

export { parseVoidRoundArgs, type VoidRoundArgs }

export const VOID_REASONS = ['data_error', 'event_voided', 'operator_void'] as const
export type VoidReason = (typeof VOID_REASONS)[number]

export type VoidRoundPlan = {
  roundId: string
  instrument: string
  category: string
  gradingStatus: string | null
  actualOutcome: string | null
  chargedJobs: number
  refundableCredits: number
  apply: boolean
  reason: string
}

export type VoidRoundResult =
  | { ok: true; dryRun: true; plan: VoidRoundPlan }
  | { ok: true; dryRun: false; plan: VoidRoundPlan; refundedCredits: number }
  | { ok: false; error: string }

export function isVoidReason(raw: string): raw is VoidReason {
  return (VOID_REASONS as readonly string[]).includes(raw)
}

export async function planVoidRound(roundId: string, reason: string, apply: boolean): Promise<
  { ok: true; plan: VoidRoundPlan } | { ok: false; error: string }
> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, category, grading_status, actual_outcome')
    .eq('id', roundId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'round not found' }
  const jobs = await listChargedUnrefundedForRound(roundId)
  const refundableCredits = jobs.reduce((sum, job) => {
    if (!job.user_id || job.charged_cost < 1 || job.deduct_skipped) return sum
    return sum + job.charged_cost
  }, 0)
  return {
    ok: true,
    plan: {
      roundId: data.id,
      instrument: String(data.instrument ?? ''),
      category: String(data.category ?? ''),
      gradingStatus: data.grading_status == null ? null : String(data.grading_status),
      actualOutcome: data.actual_outcome == null ? null : String(data.actual_outcome),
      chargedJobs: jobs.length,
      refundableCredits,
      apply,
      reason,
    },
  }
}

export async function applyVoidRound(plan: VoidRoundPlan): Promise<
  { ok: true; refundedCredits: number } | { ok: false; error: string }
> {
  if (plan.actualOutcome !== null || plan.gradingStatus === 'graded') {
    return { ok: false, error: 'already graded — refuse void' }
  }
  if (plan.gradingStatus === 'voided') {
    return { ok: false, error: 'already voided' }
  }
  const nowIso = new Date().toISOString()
  const note = `REFUND: voided (${plan.reason})`
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .update({
      grading_status: 'voided',
      unresolvable_reason: plan.reason.slice(0, 80),
      unresolvable_detail: note.slice(0, 500),
      grading_attempted_at: nowIso,
      grading_busy_until: null,
    })
    .eq('id', plan.roundId)
    .is('actual_outcome', null)
    .neq('grading_status', 'voided')
    .neq('grading_status', 'graded')
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) {
    return { ok: false, error: 'round was graded or voided by another pass' }
  }
  const refundedCredits = await refundChargedJobsForRound(plan.roundId)
  scheduleLessonRefresh(plan.roundId)
  return { ok: true, refundedCredits }
}

export async function runVoidRound(args: VoidRoundArgs): Promise<VoidRoundResult> {
  const planned = await planVoidRound(args.roundId, args.reason, args.apply)
  if (!planned.ok) return planned
  if (!args.apply) return { ok: true, dryRun: true, plan: planned.plan }
  const applied = await applyVoidRound(planned.plan)
  if (!applied.ok) return applied
  return { ok: true, dryRun: false, plan: planned.plan, refundedCredits: applied.refundedCredits }
}

export async function refundChargedJobsForRound(roundId: string): Promise<number> {
  const jobs: LeagueGenerationJob[] = await listChargedUnrefundedForRound(roundId)
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
      await supabaseAdmin.from('credit_logs').insert({
        user_id: job.user_id,
        module: LEAGUE_VOID_REFUND_MODULE,
        amount: job.charged_cost,
        balance_before: grant.balance - job.charged_cost,
        balance_after: grant.balance,
      })
    }
  }
  return total
}
