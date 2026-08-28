import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { gradeRoundOnRead } from '@/lib/prediction/reconciliation'
import { buildCardData, type PredictionRow, type RoundRow } from './card-aggregate'
import type { CardData } from './card-types'
import { fetchLeaderboardData, type LeaderboardScope } from './leaderboard'
import { getCachedLivePrice } from './live-price-cache'
import type { VerdictCrossRoundGrade } from './verdict-aggregate'

/**
 * AI Prediction League — CARD DATA CONTRACT (Layer 1), DB read path.
 *
 * Reads one round + its model_predictions and hands them to the pure
 * `buildCardData` (see `card-aggregate.ts`) to assemble the read-only
 * `CardData` the UI consumes. This module never CREATES anything — generation
 * remains the orchestrator's job (`lib/league/orchestrator.ts`), which this file
 * does not import and does not call.
 *
 * The one write it can cause is GRADE-ON-READ: opening a round whose deadline
 * has passed is what triggers grading for that round (see `startGradingOnRead`).
 * It is fire-and-forget, it is claimed so concurrent readers cannot double-grade,
 * and it can only ever grade a round that is already due and still ungraded.
 */

export { buildCardData }
export type { CardData }

const ROUND_COLUMNS =
  'id, proposition_text, category, color_bucket, instrument, horizon, resolution_rule, resolves_at, opened_at, actual_outcome, resolved_at'
const PREDICTION_COLUMNS =
  'id, model_id, brand, camp, league_tier, predicted_direction, predicted_value, predicted_magnitude_pct, reasoning_snippet, is_correct, cost_usd, predicted_at'

/** Warn once (not once per request) if the anchor-price migration hasn't been applied yet. */
let warnedMissingAnchorColumns = false

export type CardLookup = { roundId: string } | { instrument: string; date?: string; horizon?: string }

export class CardNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CardNotFoundError'
  }
}

/** Resolves a lookup (round id, or instrument [+ date]) to the round row. */
async function loadRound(lookup: CardLookup): Promise<RoundRow> {
  if ('roundId' in lookup) {
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .select(ROUND_COLUMNS)
      .eq('id', lookup.roundId)
      .maybeSingle()
    if (error) throw new Error(`league card: round lookup failed (${error.message})`)
    if (!data) throw new CardNotFoundError(`No round with id ${lookup.roundId}`)
    return data as RoundRow
  }

  // instrument (+ optional date): most recent round for that instrument,
  // optionally narrowed to the UTC day of `date` (opened_at).
  let query = supabaseAdmin
    .from('prediction_rounds')
    .select(ROUND_COLUMNS)
    .eq('instrument', lookup.instrument)
    .order('opened_at', { ascending: false })

  if (lookup.date) {
    const dayStart = `${lookup.date}T00:00:00.000Z`
    const dayEnd = `${lookup.date}T23:59:59.999Z`
    query = query.gte('opened_at', dayStart).lte('opened_at', dayEnd)
  }
  if (lookup.horizon) {
    query = query.eq('horizon', lookup.horizon)
  }

  const { data, error } = await query.limit(1).maybeSingle()
  if (error) throw new Error(`league card: instrument lookup failed (${error.message})`)
  if (!data) {
    throw new CardNotFoundError(
      `No round for instrument ${lookup.instrument}${lookup.date ? ` on ${lookup.date}` : ''}`
    )
  }
  return data as RoundRow
}

type OptionalRoundColumns = {
  anchor_price: number | null
  anchor_price_at: string | null
  grading_busy_until: string | null
  grading_attempted_at: string | null
  unresolvable_reason: string | null
  anchor_session_date: string | null
  resolution_session_date: string | null
  resolution_price: number | null
}

const EMPTY_OPTIONAL_COLUMNS: OptionalRoundColumns = {
  anchor_price: null,
  anchor_price_at: null,
  grading_busy_until: null,
  grading_attempted_at: null,
  unresolvable_reason: null,
  anchor_session_date: null,
  resolution_session_date: null,
  resolution_price: null,
}

/**
 * Deliberately SEPARATE from `loadRound`'s select (rather than adding these to
 * `ROUND_COLUMNS`): migrations `20260818000002_league_anchor_price.sql` and
 * `20260821000002_prediction_grading_state.sql` may not be applied to every
 * environment yet (same situation as `league_research_packets` — see
 * `lib/league/research.ts`'s `readDurableCache`). Selecting an unknown column
 * would fail the WHOLE query; isolating it here means a not-yet-migrated DB just
 * renders the card without an anchor price and with the grading state that
 * `resolves_at` + `actual_outcome` alone can prove, instead of breaking every
 * card read.
 */
async function loadOptionalColumns(roundId: string): Promise<OptionalRoundColumns> {
  try {
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .select(
        'anchor_price, anchor_price_at, grading_busy_until, grading_attempted_at, unresolvable_reason, anchor_session_date, resolution_session_date, resolution_price'
      )
      .eq('id', roundId)
      .maybeSingle()
    if (error) {
      const fallback = await supabaseAdmin
        .from('prediction_rounds')
        .select(
          'anchor_price, anchor_price_at, grading_busy_until, grading_attempted_at, unresolvable_reason, resolution_session_date, resolution_price'
        )
        .eq('id', roundId)
        .maybeSingle()
      if (!fallback.error && fallback.data) {
        return {
          anchor_price: fallback.data.anchor_price ?? null,
          anchor_price_at: fallback.data.anchor_price_at ?? null,
          grading_busy_until: fallback.data.grading_busy_until ?? null,
          grading_attempted_at: fallback.data.grading_attempted_at ?? null,
          unresolvable_reason: fallback.data.unresolvable_reason ?? null,
          anchor_session_date: null,
          resolution_session_date: fallback.data.resolution_session_date ?? null,
          resolution_price: fallback.data.resolution_price ?? null,
        }
      }
      if (!warnedMissingAnchorColumns) {
        warnedMissingAnchorColumns = true
        console.warn(
          `[league/card] optional round columns unavailable (${error.message}) — rendering cards without an anchor ` +
            'price / grading state. Apply migrations 20260818000002_league_anchor_price.sql and ' +
            '20260821000002_prediction_grading_state.sql to enable them.'
        )
      }
      return EMPTY_OPTIONAL_COLUMNS
    }
    if (!data) return EMPTY_OPTIONAL_COLUMNS
    return {
      anchor_price: data.anchor_price ?? null,
      anchor_price_at: data.anchor_price_at ?? null,
      grading_busy_until: data.grading_busy_until ?? null,
      grading_attempted_at: data.grading_attempted_at ?? null,
      unresolvable_reason: data.unresolvable_reason ?? null,
      anchor_session_date: data.anchor_session_date ?? null,
      resolution_session_date: data.resolution_session_date ?? null,
      resolution_price: data.resolution_price ?? null,
    }
  } catch {
    return EMPTY_OPTIONAL_COLUMNS
  }
}

async function loadPredictions(roundId: string): Promise<PredictionRow[]> {
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select(PREDICTION_COLUMNS)
    .eq('round_id', roundId)
    .order('predicted_at', { ascending: true })
  if (error) throw new Error(`league card: predictions lookup failed (${error.message})`)
  return (data ?? []) as PredictionRow[]
}

type CrossRoundQueryRow = {
  model_id: string
  round_id: string
  is_correct: boolean | null
  prediction_rounds:
    | { instrument: string; resolved_at: string | null }
    | { instrument: string; resolved_at: string | null }[]
    | null
}

/**
 * Graded history for this instrument — feeds streaks / crossRoundRates on the
 * verdict panel. Rows without a resolved_at are dropped (streaks need a total
 * order). Failures degrade to [] so a join hiccup never breaks the card.
 */
async function loadCrossRoundGrades(instrument: string): Promise<VerdictCrossRoundGrade[]> {
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select('model_id, round_id, is_correct, prediction_rounds!inner(instrument, resolved_at)')
    .eq('prediction_rounds.instrument', instrument)
    .not('is_correct', 'is', null)

  if (error || !data) {
    if (error) {
      console.warn(`[league/card] cross-round grades unavailable (${error.message}) — streaks omitted`)
    }
    return []
  }

  const out: VerdictCrossRoundGrade[] = []
  for (const row of data as unknown as CrossRoundQueryRow[]) {
    if (row.is_correct === null) continue
    const joined = Array.isArray(row.prediction_rounds) ? row.prediction_rounds[0] : row.prediction_rounds
    const resolvedAt = joined?.resolved_at
    if (!resolvedAt) continue
    out.push({
      model_id: row.model_id,
      round_id: row.round_id,
      is_correct: row.is_correct,
      resolved_at: resolvedAt,
    })
  }
  return out
}

/**
 * GRADE-ON-READ. A round whose deadline has passed and that nobody has graded
 * is graded because someone LOOKED at it — no cron, no operator decision. The
 * reader waits for nothing: grading is started and abandoned here, the card goes
 * out with `gradingState: 'grading'`, and the grade appears on the next read.
 *
 * Concurrency is not this function's problem: `gradeRoundOnRead` claims the
 * round with a conditional update, so N simultaneous readers produce exactly one
 * grading attempt and no double-grade (see `lib/prediction/grading-core.ts`).
 * Worst case the request ends before grading finishes; the claim lease expires
 * and the next read picks it up again.
 */
function startGradingOnRead(roundId: string): void {
  void gradeRoundOnRead(roundId).catch((e: unknown) => {
    console.warn(
      `[league/card] grade-on-read failed for round ${roundId}: ${e instanceof Error ? e.message : 'unknown error'}`
    )
  })
}

/** Full read path: resolve the round, load its predictions, assemble CardData. */
export async function fetchCardData(lookup: CardLookup, scope?: LeaderboardScope): Promise<CardData> {
  const round = await loadRound(lookup)
  const optional = await loadOptionalColumns(round.id)
  const [predictions, board, crossRound] = await Promise.all([
    loadPredictions(round.id),
    fetchLeaderboardData(scope),
    loadCrossRoundGrades(round.instrument),
  ])
  const card = buildCardData({ ...round, ...optional }, predictions, board.combined, crossRound)

  if (card.round.gradingState === 'due_ungraded') {
    startGradingOnRead(round.id)
    // presentCardGrading already refused to advertise a missing-anchor round
    // as due_ungraded, so reaching here means there is a baseline to grade
    // against. The reader sees 'grading' and the client polls until it lands.
    card.round.gradingState = 'grading'
  }

  // Secondary, best-effort, non-blocking — see `live-price-cache.ts`'s doc
  // comment. A cache miss/provider hiccup just leaves this null; it never
  // adds latency or a failure mode to this read.
  const live = getCachedLivePrice(round.instrument)
  if (live) {
    card.round.livePrice = live.price
    card.round.livePriceAt = live.asOf
  }
  return card
}
