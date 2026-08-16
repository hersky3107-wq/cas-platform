import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { buildCardData, type PredictionRow, type RoundRow } from './card-aggregate'
import type { CardData } from './card-types'

/**
 * AI Prediction League — CARD DATA CONTRACT (Layer 1), DB read path.
 *
 * Reads one round + its model_predictions and hands them to the pure
 * `buildCardData` (see `card-aggregate.ts`) to assemble the read-only
 * `CardData` the UI consumes. This module NEVER writes to the ledger — that
 * remains the orchestrator's job (`lib/league/orchestrator.ts`), which this
 * file does not import and does not call.
 */

export { buildCardData }
export type { CardData }

const ROUND_COLUMNS =
  'id, proposition_text, category, color_bucket, instrument, horizon, resolution_rule, resolves_at, opened_at, actual_outcome, resolved_at'
const PREDICTION_COLUMNS =
  'model_id, brand, camp, league_tier, predicted_direction, predicted_value, reasoning_snippet, is_correct, cost_usd, predicted_at'

export type CardLookup = { roundId: string } | { instrument: string; date?: string }

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

  const { data, error } = await query.limit(1).maybeSingle()
  if (error) throw new Error(`league card: instrument lookup failed (${error.message})`)
  if (!data) {
    throw new CardNotFoundError(
      `No round for instrument ${lookup.instrument}${lookup.date ? ` on ${lookup.date}` : ''}`
    )
  }
  return data as RoundRow
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

/** Full read path: resolve the round, load its predictions, assemble CardData. */
export async function fetchCardData(lookup: CardLookup): Promise<CardData> {
  const round = await loadRound(lookup)
  const predictions = await loadPredictions(round.id)
  return buildCardData(round, predictions)
}
