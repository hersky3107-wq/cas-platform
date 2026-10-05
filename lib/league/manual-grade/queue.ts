import 'server-only'

import { planForRound } from '@/lib/league/gateway/plan-for-round'
import { supabaseAdmin } from '@/lib/supabase/server'
import { getSiteUrl } from '@/lib/supabase/site-url'
import { sideLabelsFor } from '@/lib/league/side-labels'
import { LEAGUE_UI } from '@/lib/league/i18n/dictionary'
import type { ManualQueueItem } from './types'
import { notifyManualGradeQueued } from './telegram'
import { koreanAdminCopyForRounds } from '@/lib/league/admin-proposition-ko'

const QUEUE_COLUMNS =
  'id, proposition_text, propositions, resolution_rule, category, instrument, horizon, proposition_kind, subject_label, resolves_at, created_at, actual_outcome, grading_status'

export async function countNeedsGrading(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id', { count: 'exact', head: true })
    .eq('grading_status', 'needs_grading')
    .is('actual_outcome', null)
    .lt('resolves_at', new Date().toISOString())
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function listNeedsGradingQueue(): Promise<ManualQueueItem[]> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select(QUEUE_COLUMNS)
    .eq('grading_status', 'needs_grading')
    .is('actual_outcome', null)
    .lt('resolves_at', new Date().toISOString())
    .order('resolves_at', { ascending: true })
    .limit(200)
  if (error) throw new Error(error.message)
  const rows = data ?? []
  if (rows.length === 0) return []

  const ids = rows.map((r) => String(r.id))
  const jobsByRound = await loadChargedJobs(ids)
  const nullSeatsByRound = await loadNullSeats(ids)
  const countersByRound = await loadSeatCounters(ids)
  const t = LEAGUE_UI.ko
  const korean = await koreanAdminCopyForRounds(
    rows.map((row) => ({
      id: String(row.id),
      proposition_text: String(row.proposition_text ?? ''),
      resolution_rule: String(row.resolution_rule ?? ''),
      propositions: row.propositions,
    })),
  )

  return rows.map((row) => {
    const labels = sideLabelsFor(
      {
        proposition_kind: row.proposition_kind as string | null,
        subject_label: row.subject_label as string | null,
        category: row.category as string,
        instrument: row.instrument as string,
      },
      t,
      'ko',
    )
    const copy = korean.get(String(row.id))
    const jobs = jobsByRound.get(String(row.id)) ?? []
    const charged = jobs.reduce((sum, j) => sum + (j.charged_cost > 0 && !j.refunded ? j.charged_cost : 0), 0)
    const creator = jobs.find((j) => j.user_id)?.user_id ?? null
    return {
      id: String(row.id),
      proposition_text: copy?.propositionKo || String(row.proposition_text ?? ''),
      proposition_ko: copy?.propositionKo,
      proposition_en: copy?.propositionEn,
      resolution_rule: String(row.resolution_rule ?? ''),
      resolution_rule_ko: copy?.resolutionRuleKo,
      category: String(row.category ?? ''),
      instrument: String(row.instrument ?? ''),
      horizon: String(row.horizon ?? ''),
      proposition_kind: typeof row.proposition_kind === 'string' ? row.proposition_kind : null,
      subject_label: typeof row.subject_label === 'string' ? row.subject_label : null,
      resolves_at: String(row.resolves_at ?? ''),
      created_at: typeof row.created_at === 'string' ? row.created_at : null,
      creator_user_id: creator,
      charged_credits: charged,
      side_a: labels.badge(labels.sides[0]),
      side_b: labels.badge(labels.sides[1]),
      null_seats: nullSeatsByRound.get(String(row.id)) ?? [],
      seat_counters: countersByRound.get(String(row.id)) ?? [],
    }
  })
}

async function loadNullSeats(roundIds: string[]) {
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select('round_id, model_id, fail_reason')
    .in('round_id', roundIds)
    .is('predicted_direction', null)
  if (error) {
    const fallback = await supabaseAdmin
      .from('model_predictions')
      .select('round_id, model_id')
      .in('round_id', roundIds)
      .is('predicted_direction', null)
    if (fallback.error) throw new Error(fallback.error.message)
    const map = new Map<string, Array<{ model_id: string; fail_reason: string | null }>>()
    for (const row of fallback.data ?? []) {
      const rid = String(row.round_id)
      const list = map.get(rid) ?? []
      list.push({ model_id: String(row.model_id), fail_reason: null })
      map.set(rid, list)
    }
    return map
  }
  const map = new Map<string, Array<{ model_id: string; fail_reason: string | null }>>()
  for (const row of data ?? []) {
    const rid = String(row.round_id)
    const list = map.get(rid) ?? []
    list.push({
      model_id: String(row.model_id),
      fail_reason: typeof row.fail_reason === 'string' ? row.fail_reason : null,
    })
    map.set(rid, list)
  }
  return map
}

async function loadSeatCounters(roundIds: string[]) {
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select('round_id, model_id, strongest_counter')
    .in('round_id', roundIds)
    .not('strongest_counter', 'is', null)
  if (error) return new Map<string, Array<{ model_id: string; strongest_counter: string }>>()
  const map = new Map<string, Array<{ model_id: string; strongest_counter: string }>>()
  for (const row of data ?? []) {
    const text = typeof row.strongest_counter === 'string' ? row.strongest_counter.trim() : ''
    if (!text) continue
    const rid = String(row.round_id)
    const list = map.get(rid) ?? []
    list.push({ model_id: String(row.model_id), strongest_counter: text })
    map.set(rid, list)
  }
  return map
}

async function loadChargedJobs(roundIds: string[]) {
  const { data, error } = await supabaseAdmin
    .from('league_generation_jobs')
    .select('round_id, user_id, charged, charged_cost, refunded')
    .in('round_id', roundIds)
    .eq('charged', true)
  if (error) throw new Error(error.message)
  const map = new Map<
    string,
    Array<{ user_id: string | null; charged_cost: number; refunded: boolean }>
  >()
  for (const row of data ?? []) {
    const id = String((row as { round_id: string }).round_id)
    const list = map.get(id) ?? []
    list.push({
      user_id: typeof (row as { user_id: string | null }).user_id === 'string' ? (row as { user_id: string }).user_id : null,
      charged_cost: Number((row as { charged_cost: number }).charged_cost ?? 0),
      refunded: Boolean((row as { refunded: boolean }).refunded),
    })
    map.set(id, list)
  }
  return map
}

/**
 * Due freeform rounds with no auto-executor → needs_grading (once).
 * Price-series rounds are never touched. Telegram fires only on a fresh park.
 */
export async function parkDueManualRounds(now = new Date()): Promise<{ scanned: number; newlyQueued: number }> {
  const nowIso = now.toISOString()
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, category, proposition_text, resolves_at, grading_status, actual_outcome')
    .lt('resolves_at', nowIso)
    .is('actual_outcome', null)
    .eq('grading_status', 'auto')
    .order('resolves_at', { ascending: true })
    .limit(200)
  if (error) throw new Error(error.message)

  let newlyQueued = 0
  const due = data ?? []
  for (const row of due) {
    const plan = planForRound(String(row.instrument), String(row.category))
    if (
      plan.source === 'price_series' ||
      plan.source === 'kobis' ||
      plan.source === 'lmarena' ||
      plan.source === 'api_football'
    ) {
      continue
    }
    const parked = await parkRoundForManual(String(row.id), nowIso, {
      proposition: String(row.proposition_text ?? ''),
      category: String(row.category ?? ''),
      resolvesAt: String(row.resolves_at ?? ''),
    })
    if (parked.newlyQueued) newlyQueued += 1
  }
  return { scanned: due.length, newlyQueued }
}

export async function parkRoundForManual(
  roundId: string,
  nowIso: string,
  notify?: { proposition: string; category: string; resolvesAt: string }
): Promise<{ newlyQueued: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .update({
      grading_status: 'needs_grading',
      grading_attempted_at: nowIso,
      grading_busy_until: null,
    })
    .eq('id', roundId)
    .is('actual_outcome', null)
    .eq('grading_status', 'auto')
    .select('id')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { newlyQueued: false }

  if (notify) {
    const origin = getSiteUrl()
    void notifyManualGradeQueued({
      proposition: notify.proposition,
      category: notify.category,
      resolvesAt: notify.resolvesAt,
      gradeUrl: `${origin.replace(/\/$/, '')}/admin/league/grade?id=${roundId}`,
    }).catch(() => {})
  }
  return { newlyQueued: true }
}
