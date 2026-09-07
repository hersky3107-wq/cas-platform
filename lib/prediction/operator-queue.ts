import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { planForRound } from '@/lib/league/gateway/plan-for-round'
import { sideLabelsFor, tallySlotOfToken, toSideToken } from '@/lib/league/side-labels'
import { LEAGUE_UI } from '@/lib/league/i18n/dictionary'
import type { OperatorQueueItem } from './operator-queue-types'

export type { OperatorQueueItem }

const QUEUE_COLUMNS =
  'id, proposition_text, category, instrument, horizon, proposition_kind, subject_label, resolves_at, actual_outcome'

/**
 * Every due, ungraded round whose grade plan is operator_manual.
 * Auth belongs to the route; this is the listing query only.
 */
export async function listOperatorGradeQueue(nowMs = Date.now()): Promise<OperatorQueueItem[]> {
  const nowIso = new Date(nowMs).toISOString()
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select(QUEUE_COLUMNS)
    .is('actual_outcome', null)
    .lt('resolves_at', nowIso)
    .order('resolves_at', { ascending: true })
    .limit(200)
  if (error) throw new Error(error.message)

  const due = (data ?? []).filter(
    (row) => planForRound(String(row.instrument), String(row.category)).source === 'operator_manual'
  )
  if (due.length === 0) return []

  const ids = due.map((row) => String(row.id))
  const { data: preds, error: predError } = await supabaseAdmin
    .from('model_predictions')
    .select('round_id, predicted_direction')
    .in('round_id', ids)
  if (predError) throw new Error(predError.message)

  const byRound = new Map<string, { a: number; b: number; abstain: number; total: number }>()
  for (const id of ids) byRound.set(id, { a: 0, b: 0, abstain: 0, total: 0 })
  for (const pred of preds ?? []) {
    const tally = byRound.get(String(pred.round_id))
    if (!tally) continue
    tally.total++
    const slot = tallySlotOfToken(toSideToken(pred.predicted_direction as string | null))
    if (slot === 'up') tally.a++
    else if (slot === 'down') tally.b++
    else tally.abstain++
  }

  const t = LEAGUE_UI.en
  return due.map((row) => {
    const labels = sideLabelsFor(
      {
        proposition_kind: row.proposition_kind as string | null,
        subject_label: row.subject_label as string | null,
        category: row.category as string,
      },
      t
    )
    const resolvesAt = String(row.resolves_at)
    const days = Math.max(0, Math.floor((nowMs - Date.parse(resolvesAt)) / 86_400_000))
    return {
      id: String(row.id),
      proposition_text: String(row.proposition_text ?? ''),
      subject_label: typeof row.subject_label === 'string' ? row.subject_label : null,
      category: String(row.category ?? ''),
      instrument: String(row.instrument ?? ''),
      horizon: String(row.horizon ?? ''),
      proposition_kind: labels.kind,
      side_a: labels.badge(labels.sides[0]),
      side_b: labels.badge(labels.sides[1]),
      resolves_at: resolvesAt,
      days_waiting: days,
      tally: byRound.get(String(row.id)) ?? { a: 0, b: 0, abstain: 0, total: 0 },
    }
  })
}
