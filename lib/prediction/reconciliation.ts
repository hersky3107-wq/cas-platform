import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveActualOutcome } from '@/lib/league/market-data'
import type { PredictionCategory } from './categories'

export type { PredictionCategory } from './categories'

/**
 * AI Prediction League — reconciliation skeleton.
 *
 * SCOPE (this pass): storage + reconciliation wiring ONLY. No prediction
 * GENERATION (asking the models) and no price/result API is chosen here.
 * `fetchActualOutcome` is a deliberately-unimplemented, swappable stub.
 *
 * ISOLATION: reads/writes ONLY public.prediction_rounds + public.model_predictions
 * via the service-role client. Never touches Verdict Predict or the generic
 * session tables (sessions / scores / session_participants / ai_responses /
 * session_results).
 */

/**
 * Categories with a confirmed (or trivially-available) data source that this
 * automated job will attempt to reconcile once `fetchActualOutcome` is wired.
 *
 * 'sports' is included as the ONE event source treated as trivially available
 * (final scores are broadly published); it still flows through the same
 * swappable stub, so it resolves nothing until a source is chosen.
 *
 * Everything NOT in this set is schema-only for now — politics_election,
 * entertainment_awards, memecoin, crypto_perps, commodity_energy, bond_rate,
 * futures_derivatives. Scout is graded on direction like every other tier.
 */
export const AUTO_RECONCILE_CATEGORIES: readonly PredictionCategory[] = [
  'stock',
  'etf_index',
  'crypto_spot',
  'fx',
  'gold_metal',
  'macro_econ',
  'sports',
]

export type PredictionRoundRow = {
  id: string
  category: PredictionCategory
  instrument: string
  horizon: string
  resolution_rule: string
  proposition_text: string
  resolves_at: string
  opened_at: string
}

/** Normalized outcome the reconciliation logic needs from any data source. */
export type ActualOutcome = {
  /** Raw resolved value stored verbatim on the round (price, score, result…). */
  rawOutcome: string
  /**
   * The resolved direction used to grade directional predictions. Null when the
   * source can determine a value but not a meaningful up/down/flat (grading is
   * then left to manual/v2).
   */
  actualDirection: 'up' | 'down' | 'flat' | null
}

/**
 * Swappable data-source adapter. Returns the resolved outcome for a due round,
 * or null when it cannot be resolved (source unavailable / not applicable).
 *
 * WIRED: price categories (stock/etf_index/crypto_spot/fx/gold_metal and, best
 * effort, macro_econ) resolve via Twelve Data — the same source used to build
 * the prediction data packet. Returns the resolved close + day-over-day
 * direction. Non-price instruments (e.g. 'sports' MATCH:… handles) don't map to
 * a Twelve Data symbol, so resolveActualOutcome returns null and they stay
 * effectively manual. // v2: sports/event result feeds.
 *
 * Still a single swappable function — repoint it to switch/augment sources.
 */
export async function fetchActualOutcome(
  round: PredictionRoundRow
): Promise<ActualOutcome | null> {
  const resolved = await resolveActualOutcome(round.instrument)
  if (!resolved) return null
  return { rawOutcome: resolved.rawOutcome, actualDirection: resolved.actualDirection }
}

export type ReconciliationSummary = {
  scanned: number
  resolved: number
  skippedNoSource: number
  childrenGraded: number
  errors: { roundId: string; error: string }[]
}

/**
 * Reconciliation pass:
 *  1. select due, unresolved rounds in AUTO_RECONCILE_CATEGORIES,
 *  2. call the swappable fetchActualOutcome(round) stub,
 *  3. set round.actual_outcome + resolved_at,
 *  4. grade each child model_prediction's is_correct by comparing its
 *     predicted_direction to the round's actual direction.
 *
 * Scout-league children are graded on direction like every other tier
 * (they now persist a directional call). Non-directional rows
 * (predicted_direction null) are left with is_correct = null.
 */
export async function reconcileDuePredictionRounds(limit = 200): Promise<ReconciliationSummary> {
  const summary: ReconciliationSummary = {
    scanned: 0,
    resolved: 0,
    skippedNoSource: 0,
    childrenGraded: 0,
    errors: [],
  }

  const nowIso = new Date().toISOString()

  const { data: dueRounds, error: selErr } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, category, instrument, horizon, resolution_rule, proposition_text, resolves_at, opened_at')
    .lt('resolves_at', nowIso)
    .is('actual_outcome', null)
    .in('category', AUTO_RECONCILE_CATEGORIES as unknown as string[])
    .order('resolves_at', { ascending: true })
    .limit(limit)

  if (selErr) {
    summary.errors.push({ roundId: '(select)', error: selErr.message })
    return summary
  }

  const rounds = (dueRounds ?? []) as PredictionRoundRow[]
  summary.scanned = rounds.length

  for (const round of rounds) {
    try {
      const outcome = await fetchActualOutcome(round)
      if (!outcome) {
        // No source wired yet (or transient miss) — leave for a later pass.
        summary.skippedNoSource += 1
        continue
      }

      const resolvedAt = new Date().toISOString()
      const { error: updErr } = await supabaseAdmin
        .from('prediction_rounds')
        .update({ actual_outcome: outcome.rawOutcome, resolved_at: resolvedAt })
        .eq('id', round.id)
        .is('actual_outcome', null) // idempotency guard against a racing pass

      if (updErr) {
        summary.errors.push({ roundId: round.id, error: updErr.message })
        continue
      }
      summary.resolved += 1

      // Grade children only when the source gave a usable direction.
      if (outcome.actualDirection == null) continue

      summary.childrenGraded += await gradeChildren(round.id, outcome.actualDirection)
    } catch (e: unknown) {
      summary.errors.push({
        roundId: round.id,
        error: e instanceof Error ? e.message : 'unknown reconciliation error',
      })
    }
  }

  return summary
}

/**
 * Sets is_correct for a round's directional children. Returns how many rows
 * were graded. Null-direction rows are skipped (they keep is_correct = null).
 * Scout is included — same directional compare as every other tier.
 */
async function gradeChildren(
  roundId: string,
  actualDirection: 'up' | 'down' | 'flat'
): Promise<number> {
  const { data: children, error } = await supabaseAdmin
    .from('model_predictions')
    .select('id, predicted_direction')
    .eq('round_id', roundId)

  if (error || !children) return 0

  let graded = 0
  for (const child of children as {
    id: string
    predicted_direction: string | null
  }[]) {
    if (child.predicted_direction == null) continue

    const isCorrect = child.predicted_direction === actualDirection
    const { error: updErr } = await supabaseAdmin
      .from('model_predictions')
      .update({ is_correct: isCorrect })
      .eq('id', child.id)
    if (!updErr) graded += 1
  }
  return graded
}
