/**
 * Persist program-computed lesson notes and phrase them with gemini-3.5-flash.
 * Server-only. Missing table is a no-op so grading still finishes.
 */
import 'server-only'

import { runSingleAiProvider } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import { selectGradedConsensusTrackRounds, type GradedConsensusRoundRow } from '../graded-consensus-rounds'
import { isExtraSeat } from './seats'
import {
  computeLessonStats,
  extrasFromPredictionRows,
  lessonNoteTemplate,
  noteNumbersAreGrounded,
  resolvePhrasedNote,
  type LessonSourceRound,
  type LessonStats,
} from './lesson-stats'

export const LESSON_GLOBAL_CATEGORY = '*'
export const LESSON_GLOBAL_HORIZON = '*'
export const LESSON_PHRASE_MODEL = 'gemini-3.5-flash'

export type LessonNoteRow = {
  category: string
  horizon: string
  scope: 'category' | 'global'
  stats: LessonStats
  note_text_ko: string
  note_text_en: string
  n_rounds: number
}

type PhraseResult = { ko: string; en: string }

async function phraseOnce(stats: LessonStats): Promise<PhraseResult | null> {
  const res = await runSingleAiProvider({
    supabase: supabaseAdmin,
    authSupabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: 'google',
    prompt: [
      'Write two short notes, Korean then English, from ONLY these stats.',
      'Every number you write must appear in the JSON. Do not invent a count.',
      'Prefix thin samples exactly as the template does: 참고(표본 n) when n is 3 or 4. Omit any slice with n < 3.',
      'Return JSON: {"ko":"...","en":"..."}',
      JSON.stringify(stats),
    ].join('\n'),
    systemPrompt: 'You phrase precomputed league stats. You do not calculate.',
    skipLanguageInjection: true,
    maxCompletionTokens: 600,
    modelOverride: LESSON_PHRASE_MODEL,
    timeoutMs: 30_000,
  })
  if (!res.text) return null
  const match = res.text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0]) as { ko?: unknown; en?: unknown }
    if (typeof obj.ko !== 'string' || typeof obj.en !== 'string') return null
    return { ko: obj.ko.trim(), en: obj.en.trim() }
  } catch {
    return null
  }
}

export async function phraseLessonNote(stats: LessonStats, phrase: typeof phraseOnce = phraseOnce): Promise<PhraseResult> {
  if (stats.n < 3) return resolvePhrasedNote(stats, [])
  const first = await phrase(stats).catch(() => null)
  const firstOk = Boolean(
    first && noteNumbersAreGrounded(first.ko, stats) && noteNumbersAreGrounded(first.en, stats),
  )
  const second = firstOk ? null : await phrase(stats).catch(() => null)
  return resolvePhrasedNote(stats, [first, second])
}

function majoritySharePct(
  rows: readonly { model_id?: string | null; league_tier?: string | null; predicted_direction?: string | null }[],
  majority: string | null,
): number | null {
  if (!majority) return null
  const official = rows.filter((row) => !isExtraSeat(row) && row.predicted_direction)
  if (official.length === 0) return null
  const onSide = official.filter((row) => row.predicted_direction?.toLowerCase() === majority.toLowerCase()).length
  return Math.round((onSide / official.length) * 100)
}

type LessonRoundRow = GradedConsensusRoundRow & {
  consensus_majority_direction?: string | null
  consensus_aggregate_direction?: string | null
  consensus_aggregate_probability?: number | null
}

export async function loadLessonSourceRounds(): Promise<LessonSourceRound[]> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select(
      'id, category, horizon, instrument, opened_at, grading_status, unresolvable_reason, actual_outcome, consensus_is_correct, consensus_majority_direction, consensus_aggregate_direction, consensus_aggregate_probability, anchor_session_date, resolution_session_date',
    )
    .not('actual_outcome', 'is', null)
    .eq('is_test', false)
  if (error) throw new Error(error.message)
  const rounds = selectGradedConsensusTrackRounds((data ?? []) as LessonRoundRow[])
  const ids = rounds.map((row) => String(row.id ?? ''))
  const predictions: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200)
    const { data: preds, error: predError } = await supabaseAdmin
      .from('model_predictions')
      .select('round_id, model_id, league_tier, predicted_direction, is_correct')
      .in('round_id', slice)
    if (predError) throw new Error(predError.message)
    predictions.push(...((preds ?? []) as Record<string, unknown>[]))
  }
  const byRound = new Map<string, Record<string, unknown>[]>()
  for (const row of predictions) {
    const id = String(row.round_id)
    const list = byRound.get(id) ?? []
    list.push(row)
    byRound.set(id, list)
  }
  return rounds.map((row) => {
    const preds = byRound.get(String(row.id)) ?? []
    const majority = row.consensus_majority_direction == null ? null : String(row.consensus_majority_direction)
    return {
      id: String(row.id ?? ''),
      category: String(row.category ?? ''),
      horizon: String(row.horizon ?? ''),
      instrument: String(row.instrument ?? ''),
      openedAt: String(row.opened_at ?? ''),
      gradingStatus: String(row.grading_status ?? ''),
      unresolvableReason: row.unresolvable_reason == null ? null : String(row.unresolvable_reason),
      actualOutcome: row.actual_outcome == null ? null : String(row.actual_outcome),
      anchorSessionDate: row.anchor_session_date == null ? null : String(row.anchor_session_date),
      resolutionSessionDate: row.resolution_session_date == null ? null : String(row.resolution_session_date),
      consensusIsCorrect:
        typeof row.consensus_is_correct === 'boolean' ? row.consensus_is_correct : null,
      majorityDirection: majority,
      aggregateDirection: row.consensus_aggregate_direction == null ? null : String(row.consensus_aggregate_direction),
      aggregateProbability:
        typeof row.consensus_aggregate_probability === 'number' ? row.consensus_aggregate_probability : null,
      majoritySharePct: majoritySharePct(
        preds.map((pred) => ({
          model_id: pred.model_id == null ? null : String(pred.model_id),
          league_tier: pred.league_tier == null ? null : String(pred.league_tier),
          predicted_direction: pred.predicted_direction == null ? null : String(pred.predicted_direction),
        })),
        majority,
      ),
      extras: extrasFromPredictionRows(
        preds.map((pred) => ({
          model_id: pred.model_id == null ? null : String(pred.model_id),
          is_correct: typeof pred.is_correct === 'boolean' ? pred.is_correct : null,
        })),
      ),
    }
  })
}

export function planLessonNotes(rounds: readonly LessonSourceRound[]): LessonNoteRow[] {
  const groups = new Map<string, LessonSourceRound[]>()
  for (const round of rounds) {
    const key = `${round.category}\t${round.horizon}`
    const list = groups.get(key) ?? []
    list.push(round)
    groups.set(key, list)
  }
  const out: LessonNoteRow[] = []
  for (const [key, rows] of groups) {
    const [category, horizon] = key.split('\t')
    const stats = computeLessonStats(rows)
    out.push({
      category: category ?? '',
      horizon: horizon ?? '',
      scope: 'category',
      stats,
      note_text_ko: lessonNoteTemplate(stats, 'ko'),
      note_text_en: lessonNoteTemplate(stats, 'en'),
      n_rounds: stats.n,
    })
  }
  const globalStats = computeLessonStats(rounds)
  out.push({
    category: LESSON_GLOBAL_CATEGORY,
    horizon: LESSON_GLOBAL_HORIZON,
    scope: 'global',
    stats: globalStats,
    note_text_ko: lessonNoteTemplate(globalStats, 'ko'),
    note_text_en: lessonNoteTemplate(globalStats, 'en'),
    n_rounds: globalStats.n,
  })
  return out
}

export async function upsertLessonNote(row: LessonNoteRow): Promise<void> {
  const { error } = await supabaseAdmin.from('league_lesson_notes').upsert(
    {
      category: row.category,
      horizon: row.horizon,
      scope: row.scope,
      stats: row.stats,
      note_text_ko: row.note_text_ko,
      note_text_en: row.note_text_en,
      n_rounds: row.n_rounds,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'category,horizon,scope' },
  )
  if (error) throw new Error(error.message)
}

export async function rebuildLessonNotes(apply: boolean): Promise<{ notes: LessonNoteRow[]; applied: boolean }> {
  const rounds = await loadLessonSourceRounds()
  const planned = planLessonNotes(rounds)
  if (!apply) return { notes: planned, applied: false }
  for (const row of planned) {
    const phrased = await phraseLessonNote(row.stats)
    await upsertLessonNote({ ...row, note_text_ko: phrased.ko, note_text_en: phrased.en })
  }
  return { notes: planned, applied: true }
}

export async function refreshLessonNotesForRound(roundId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('category, horizon')
    .eq('id', roundId)
    .maybeSingle()
  if (error || !data) return
  const category = String((data as { category?: string }).category ?? '')
  const horizon = String((data as { horizon?: string }).horizon ?? '')
  const rounds = await loadLessonSourceRounds()
  const cell = planLessonNotes(rounds).filter(
    (row) =>
      (row.scope === 'category' && row.category === category && row.horizon === horizon) || row.scope === 'global',
  )
  for (const row of cell) {
    const phrased = await phraseLessonNote(row.stats)
    await upsertLessonNote({ ...row, note_text_ko: phrased.ko, note_text_en: phrased.en })
  }
}

export function scheduleLessonRefresh(roundId: string): void {
  void refreshLessonNotesForRound(roundId).catch((e: unknown) => {
    console.warn(`[lesson-notes] refresh skipped: ${e instanceof Error ? e.message : e}`)
  })
}

export async function loadLessonNotesForPrompt(category: string, horizon: string): Promise<{
  categoryNote: string | null
  globalNote: string | null
}> {
  const { data, error } = await supabaseAdmin
    .from('league_lesson_notes')
    .select('category, horizon, scope, note_text_ko, note_text_en')
    .in('scope', ['category', 'global'])
  if (error || !data) return { categoryNote: null, globalNote: null }
  const rows = data as { category: string; horizon: string; scope: string; note_text_en: string | null; note_text_ko: string | null }[]
  const cell = rows.find((row) => row.scope === 'category' && row.category === category && row.horizon === horizon)
  const global = rows.find((row) => row.scope === 'global')
  return {
    categoryNote: cell?.note_text_en ?? cell?.note_text_ko ?? null,
    globalNote: global?.note_text_en ?? global?.note_text_ko ?? null,
  }
}

export type ReplayAdminCell = {
  category: string
  horizon: string
  n: number
  replayHits: number
  replayN: number
  ensembleHits: number
  ensembleN: number
}

export type ReplayCostRow = {
  roundId: string
  instrument: string
  promptTokens: number | null
  completionTokens: number | null
  costUsd: number | null
  predictedAt: string | null
}

export async function loadReplayAdmin(): Promise<{ cells: ReplayAdminCell[]; costs: ReplayCostRow[] }> {
  const notes = await supabaseAdmin
    .from('league_lesson_notes')
    .select('category, horizon, scope, stats, n_rounds')
    .eq('scope', 'category')
  const cells: ReplayAdminCell[] = []
  if (!notes.error) {
    for (const row of (notes.data ?? []) as { category: string; horizon: string; stats: LessonStats; n_rounds: number }[]) {
      cells.push({
        category: row.category,
        horizon: row.horizon,
        n: row.n_rounds,
        replayHits: row.stats?.replay?.hits ?? 0,
        replayN: row.stats?.replay?.n ?? 0,
        ensembleHits: row.stats?.aiOverall?.hits ?? 0,
        ensembleN: row.stats?.aiOverall?.n ?? 0,
      })
    }
  }
  const costsQuery = await supabaseAdmin
    .from('model_predictions')
    .select('round_id, prompt_tokens, completion_tokens, cost_usd, predicted_at, prediction_rounds!inner(instrument)')
    .eq('model_id', 'replay')
    .order('predicted_at', { ascending: false })
    .limit(20)
  const costs: ReplayCostRow[] = []
  if (!costsQuery.error) {
    for (const row of (costsQuery.data ?? []) as Record<string, unknown>[]) {
      const round = row.prediction_rounds as { instrument?: string } | { instrument?: string }[] | null
      const instrument = Array.isArray(round) ? round[0]?.instrument : round?.instrument
      costs.push({
        roundId: String(row.round_id),
        instrument: instrument ?? '',
        promptTokens: typeof row.prompt_tokens === 'number' ? row.prompt_tokens : null,
        completionTokens: typeof row.completion_tokens === 'number' ? row.completion_tokens : null,
        costUsd: typeof row.cost_usd === 'number' ? row.cost_usd : null,
        predictedAt: row.predicted_at == null ? null : String(row.predicted_at),
      })
    }
  }
  return { cells, costs }
}
