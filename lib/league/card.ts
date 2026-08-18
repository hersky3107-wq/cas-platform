import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { buildCardData, type PredictionRow, type RoundRow } from './card-aggregate'
import type { CardData } from './card-types'
import { fetchLeaderboardData, type LeaderboardScope } from './leaderboard'
import { getCachedLivePrice } from './live-price-cache'

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

/** Warn once (not once per request) if the anchor-price migration hasn't been applied yet. */
let warnedMissingAnchorColumns = false

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

/**
 * Deliberately SEPARATE from `loadRound`'s select (rather than adding
 * `anchor_price, anchor_price_at` to `ROUND_COLUMNS`): migration
 * `20260818000002_league_anchor_price.sql` may not be applied to every
 * environment yet (same situation as `league_research_packets` — see
 * `lib/league/research.ts`'s `readDurableCache`). Selecting an unknown
 * column would fail the WHOLE query; isolating it here means a
 * not-yet-migrated DB just renders the card without an anchor price
 * (a state the UI already handles) instead of breaking every card read.
 */
async function loadAnchorPrice(roundId: string): Promise<{ anchor_price: number | null; anchor_price_at: string | null }> {
  const empty = { anchor_price: null, anchor_price_at: null }
  try {
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .select('anchor_price, anchor_price_at')
      .eq('id', roundId)
      .maybeSingle()
    if (error) {
      if (!warnedMissingAnchorColumns) {
        warnedMissingAnchorColumns = true
        console.warn(
          `[league/card] anchor_price columns unavailable (${error.message}) — rendering cards without an anchor price. ` +
            'Apply migration 20260818000002_league_anchor_price.sql to enable it.'
        )
      }
      return empty
    }
    return data ? { anchor_price: data.anchor_price ?? null, anchor_price_at: data.anchor_price_at ?? null } : empty
  } catch {
    return empty
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

/** Full read path: resolve the round, load its predictions, assemble CardData. */
export async function fetchCardData(lookup: CardLookup, scope?: LeaderboardScope): Promise<CardData> {
  const round = await loadRound(lookup)
  const anchor = await loadAnchorPrice(round.id)
  const predictions = await loadPredictions(round.id)
  const board = await fetchLeaderboardData(scope)
  const card = buildCardData({ ...round, ...anchor }, predictions, board.combined)

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
