/**
 * Class-based void for legacy same-day 24h 1d graded rounds.
 * Dry-run default. --apply writes only when the selected count is exactly 7.
 */
import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { refundChargedJobsForRound } from './admin-void-round'
import {
  EXPECTED_LEGACY_SAME_DAY_24H_COUNT,
  LEGACY_SAME_DAY_24H_REASON,
  LEGACY_SAME_DAY_24H_RULE,
  selectLegacySameDay24hRounds,
  type LegacySameDay24hRow,
} from './legacy-same-day-24h'

export { EXPECTED_LEGACY_SAME_DAY_24H_COUNT, LEGACY_SAME_DAY_24H_REASON, LEGACY_SAME_DAY_24H_RULE }

export type Legacy24hVoidListItem = LegacySameDay24hRow & {
  actual_outcome: string | null
  consensus_is_correct: boolean | null
}

export type Legacy24hVoidPlan = {
  rule: string
  reason: string
  expectedCount: number
  count: number
  countMatches: boolean
  apply: boolean
  rounds: Legacy24hVoidListItem[]
}

export type Legacy24hVoidResult =
  | { ok: true; dryRun: true; plan: Legacy24hVoidPlan }
  | { ok: true; dryRun: false; plan: Legacy24hVoidPlan; refundedCredits: number; voided: number }
  | { ok: false; error: string; plan?: Legacy24hVoidPlan }

const SELECT_COLS =
  'id, instrument, category, horizon, grading_status, actual_outcome, consensus_is_correct, anchor_session_date, resolution_session_date'

export function parseLegacy24hVoidArgs(argv: string[]): { apply: boolean } {
  let apply = false
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    else if (arg === '--dry-run') apply = false
  }
  return { apply }
}

export async function loadLegacySameDay24hCandidates(): Promise<
  { ok: true; rows: Legacy24hVoidListItem[] } | { ok: false; error: string }
> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select(SELECT_COLS)
    .eq('horizon', '1d')
    .in('category', ['gold_metal', 'fx', 'crypto_spot', 'memecoin', 'commodity_energy'])
  if (error) return { ok: false, error: error.message }
  const rows = selectLegacySameDay24hRounds((data ?? []) as Legacy24hVoidListItem[])
  return { ok: true, rows }
}

export async function planLegacySameDay24hVoid(apply: boolean): Promise<
  { ok: true; plan: Legacy24hVoidPlan } | { ok: false; error: string }
> {
  const loaded = await loadLegacySameDay24hCandidates()
  if (!loaded.ok) return loaded
  const rounds = loaded.rows.map((r) => ({
    id: r.id,
    instrument: r.instrument,
    category: r.category,
    horizon: r.horizon,
    grading_status: r.grading_status ?? null,
    actual_outcome: r.actual_outcome ?? null,
    consensus_is_correct: r.consensus_is_correct ?? null,
    anchor_session_date: r.anchor_session_date ?? null,
    resolution_session_date: r.resolution_session_date ?? null,
  }))
  return {
    ok: true,
    plan: {
      rule: LEGACY_SAME_DAY_24H_RULE,
      reason: LEGACY_SAME_DAY_24H_REASON,
      expectedCount: EXPECTED_LEGACY_SAME_DAY_24H_COUNT,
      count: rounds.length,
      countMatches: rounds.length === EXPECTED_LEGACY_SAME_DAY_24H_COUNT,
      apply,
      rounds,
    },
  }
}

export async function applyLegacySameDay24hVoid(
  plan: Legacy24hVoidPlan,
): Promise<{ ok: true; refundedCredits: number; voided: number } | { ok: false; error: string }> {
  if (!plan.countMatches) {
    return {
      ok: false,
      error: `count ${plan.count} != expected ${plan.expectedCount} — stop, do not void`,
    }
  }
  const nowIso = new Date().toISOString()
  let refundedCredits = 0
  let voided = 0
  for (const round of plan.rounds) {
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .update({
        grading_status: 'voided',
        actual_outcome: null,
        resolved_at: null,
        consensus_is_correct: null,
        unresolvable_reason: LEGACY_SAME_DAY_24H_REASON,
        unresolvable_detail: LEGACY_SAME_DAY_24H_RULE.slice(0, 500),
        graded_note: LEGACY_SAME_DAY_24H_RULE.slice(0, 500),
        grading_attempted_at: nowIso,
        grading_busy_until: null,
      })
      .eq('id', round.id)
      .neq('grading_status', 'voided')
      .select('id')
    if (error) return { ok: false, error: `${round.id}: ${error.message}` }
    if (!data || data.length === 0) continue
    const cleared = await supabaseAdmin
      .from('model_predictions')
      .update({ is_correct: null })
      .eq('round_id', round.id)
    if (cleared.error) return { ok: false, error: `${round.id} is_correct: ${cleared.error.message}` }
    refundedCredits += await refundChargedJobsForRound(round.id)
    voided += 1
  }
  console.info(
    `[league-void-legacy-24h] ${JSON.stringify({
      event: 'league_void_legacy_same_day_24h',
      rule: LEGACY_SAME_DAY_24H_RULE,
      reason: LEGACY_SAME_DAY_24H_REASON,
      count: plan.count,
      voided,
      refundedCredits,
    })}`,
  )
  return { ok: true, refundedCredits, voided }
}

export async function runLegacySameDay24hVoid(apply: boolean): Promise<Legacy24hVoidResult> {
  const planned = await planLegacySameDay24hVoid(apply)
  if (!planned.ok) return planned
  if (!apply) return { ok: true, dryRun: true, plan: planned.plan }
  if (!planned.plan.countMatches) {
    return {
      ok: false,
      error: `count ${planned.plan.count} != expected ${planned.plan.expectedCount} — stop, do not void`,
      plan: planned.plan,
    }
  }
  const applied = await applyLegacySameDay24hVoid(planned.plan)
  if (!applied.ok) return { ...applied, plan: planned.plan }
  return { ok: true, dryRun: false, plan: planned.plan, refundedCredits: applied.refundedCredits, voided: applied.voided }
}
