import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { gradeRoundOnRead } from '@/lib/prediction/reconciliation'
import { planForRound } from '@/lib/league/gateway/plan-for-round'
import { buildCardData, type PredictionRow, type RoundRow } from './card-aggregate'
import type { CardData } from './card-types'
import { fetchLeaderboardData, type LeaderboardScope } from './leaderboard'
import { getCachedLivePrice } from './live-price-cache'
import { buildSportsMarketView } from './sports-market'
import { decodeSportsInstrument, subjectTeamOf } from './gateway/adapters/sports-catalog'
import { subjectImpliedPct } from './gateway/adapters/sports-packet'
import { readFixtureCache } from './sports/cache'
import type { VerdictCrossRoundGrade } from './verdict-aggregate'
import {
  isAirankInstrument,
  decodeAirankInstrument,
  airankAllPropositions,
} from './ai-ranking/instrument'
import {
  buildBrandTableView,
  candidateListFromRanking,
  decodeActualTableOutcome,
  decodeBrandTableRanking,
  gradeBrandTableRanking,
  isBrandTableInstrument,
  mapActualBrandsToCandidates,
  BRAND_TABLE_SIZE,
} from './ai-ranking/brand-table'
import { nearestOnOrBefore } from './ai-ranking/grade'
import { brandRankingFromStore, listLeaderboardPublishDates, LMARENA_SOURCE } from './ai-ranking/ingest'
import { officialRowsForConsensus } from './extra/seats'
import { backfillTechPropositions } from './proposition-i18n.server'

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
  'id, model_id, brand, camp, league_tier, predicted_direction, predicted_value, predicted_magnitude_pct, predicted_qualifier_text, reasoning_snippet, is_correct, cost_usd, predicted_at'
const PREDICTION_COLUMNS_ADMIN =
  'id, model_id, brand, camp, league_tier, predicted_direction, predicted_value, predicted_magnitude_pct, predicted_qualifier_text, reasoning_snippet, is_correct, cost_usd, predicted_at, fail_reason'

/** Pre-20260829000002 environments lack `predicted_qualifier_text`; retried without it (see `loadPredictions`). */
const PREDICTION_COLUMNS_LEGACY =
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
    .eq('is_test', false)
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
  /** 20260829000002 — null/absent means close_higher (every pre-kind round is a price round). */
  proposition_kind: string | null
  subject_label: string | null
  propositions: Record<string, string> | null
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
  proposition_kind: null,
  subject_label: null,
  propositions: null,
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
        'anchor_price, anchor_price_at, grading_busy_until, grading_attempted_at, unresolvable_reason, anchor_session_date, resolution_session_date, resolution_price, proposition_kind, subject_label, propositions'
      )
      .eq('id', roundId)
      .maybeSingle()
    if (error) {
      const fallbackWithKind = await supabaseAdmin
        .from('prediction_rounds')
        .select(
          'anchor_price, anchor_price_at, grading_busy_until, grading_attempted_at, unresolvable_reason, anchor_session_date, resolution_session_date, resolution_price, proposition_kind, subject_label'
        )
        .eq('id', roundId)
        .maybeSingle()
      if (!fallbackWithKind.error && fallbackWithKind.data) {
        return {
          anchor_price: fallbackWithKind.data.anchor_price ?? null,
          anchor_price_at: fallbackWithKind.data.anchor_price_at ?? null,
          grading_busy_until: fallbackWithKind.data.grading_busy_until ?? null,
          grading_attempted_at: fallbackWithKind.data.grading_attempted_at ?? null,
          unresolvable_reason: fallbackWithKind.data.unresolvable_reason ?? null,
          anchor_session_date: fallbackWithKind.data.anchor_session_date ?? null,
          resolution_session_date: fallbackWithKind.data.resolution_session_date ?? null,
          resolution_price: fallbackWithKind.data.resolution_price ?? null,
          proposition_kind: fallbackWithKind.data.proposition_kind ?? null,
          subject_label: fallbackWithKind.data.subject_label ?? null,
          propositions: null,
        }
      }
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
          // Pre-20260829000002 environment: every round is a price round.
          proposition_kind: null,
          subject_label: null,
          propositions: null,
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
      proposition_kind: data.proposition_kind ?? null,
      subject_label: data.subject_label ?? null,
      propositions: (data.propositions as Record<string, string> | null) ?? null,
    }
  } catch {
    return EMPTY_OPTIONAL_COLUMNS
  }
}

async function loadOperatorEvidence(
  roundId: string
): Promise<{ sourceUrl: string; gradedAt: string } | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('prediction_round_grade_evidence')
      .select('source_url, graded_at')
      .eq('round_id', roundId)
      .maybeSingle()
    if (error || !data) return null
    const url = typeof data.source_url === 'string' ? data.source_url : ''
    const gradedAt = typeof data.graded_at === 'string' ? data.graded_at : ''
    if (!url || !gradedAt) return null
    return { sourceUrl: url, gradedAt }
  } catch {
    return null
  }
}

async function loadPredictions(roundId: string, includeFailReasons = false): Promise<PredictionRow[]> {
  if (includeFailReasons) {
    const admin = await supabaseAdmin
      .from('model_predictions')
      .select(PREDICTION_COLUMNS_ADMIN)
      .eq('round_id', roundId)
      .order('predicted_at', { ascending: true })
    if (!admin.error) return (admin.data ?? []) as unknown as PredictionRow[]
  }
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select(PREDICTION_COLUMNS)
    .eq('round_id', roundId)
    .order('predicted_at', { ascending: true })
  if (!error) return (data ?? []) as unknown as PredictionRow[]
  // Same degrade-not-break stance as `loadOptionalColumns`: a DB that
  // predates 20260829000002 renders qualifiers as null, not a broken card.
  const fallback = await supabaseAdmin
    .from('model_predictions')
    .select(PREDICTION_COLUMNS_LEGACY)
    .eq('round_id', roundId)
    .order('predicted_at', { ascending: true })
  if (fallback.error) throw new Error(`league card: predictions lookup failed (${error.message})`)
  return (fallback.data ?? []) as unknown as PredictionRow[]
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
    .eq('prediction_rounds.is_test', false)
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
export async function fetchCardData(
  lookup: CardLookup,
  scope?: LeaderboardScope,
  opts?: { includeFailReasons?: boolean },
): Promise<CardData> {
  const round = await loadRound(lookup)
  const optional = await loadOptionalColumns(round.id)

  const isOpen = round.actual_outcome === null
  const isAiModels = round.category === 'ai_models' || isAirankInstrument(round.instrument)
  const isTech = round.category === 'tech'

  if (isOpen && (isAiModels || isTech)) {
    if (!optional.propositions || Object.keys(optional.propositions).length === 0) {
      if (isAiModels) {
        const parts = decodeAirankInstrument(round.instrument)
        if (parts) {
          optional.propositions = airankAllPropositions(parts)
          void supabaseAdmin
            .from('prediction_rounds')
            .update({ propositions: optional.propositions })
            .eq('id', round.id)
            .then(() => {}, () => {})
        }
      } else if (isTech) {
        const localized = await backfillTechPropositions(round.proposition_text, round.instrument)
        if (localized) {
          optional.propositions = localized
          void supabaseAdmin
            .from('prediction_rounds')
            .update({ propositions: localized })
            .eq('id', round.id)
            .then(() => {}, () => {})
        }
      }
    }
  }

  const [predictions, board, crossRound, operatorEvidence] = await Promise.all([
    loadPredictions(round.id, opts?.includeFailReasons === true),
    fetchLeaderboardData(scope),
    loadCrossRoundGrades(round.instrument),
    loadOperatorEvidence(round.id),
  ])
  const card = buildCardData({ ...round, ...optional }, predictions, board.combined, crossRound)
  card.round.operatorEvidence = operatorEvidence

  if (card.round.gradingState === 'due_ungraded') {
    const plan = planForRound(round.instrument, round.category)
    if (plan.source !== 'operator_manual') {
      startGradingOnRead(round.id)
      // presentCardGrading already refused to advertise a missing-anchor round
      // as due_ungraded, so reaching here means there is a baseline to grade
      // against. The reader sees 'grading' and the client polls until it lands.
      card.round.gradingState = 'grading'
    }
  }

  // Secondary, best-effort, non-blocking — see `live-price-cache.ts`'s doc
  // comment. A cache miss/provider hiccup just leaves this null; it never
  // adds latency or a failure mode to this read.
  const live = getCachedLivePrice(round.instrument)
  if (live) {
    card.round.livePrice = live.price
    card.round.livePriceAt = live.asOf
  }
  if (round.category === 'sports' || round.instrument.startsWith('MATCH:')) {
    card.sportsMarket = await loadSportsMarket(card, round.instrument).catch(() =>
      buildSportsMarketView({ consensus: card.consensus, marketBaselinePct: null }),
    )
  }
  if (isBrandTableInstrument(round.instrument)) {
    card.brandTable = await loadBrandTableCardView(round, card.models).catch(() => null)
  }
  return card
}

async function loadBrandTableCardView(
  round: RoundRow,
  models: CardData['models'],
): Promise<CardData['brandTable']> {
  const parts = decodeAirankInstrument(round.instrument)
  if (!parts) return null
  const dates = await listLeaderboardPublishDates(parts.arena, parts.category)
  const latest = dates.slice().sort().at(-1)
  const openedYmd = String(round.opened_at ?? '').slice(0, 10)
  const current = latest
    ? await brandRankingFromStore(LMARENA_SOURCE, parts.arena, parts.category, latest)
    : []
  const baselineDate = openedYmd ? nearestOnOrBefore(dates, openedYmd) : null
  const baseline = baselineDate
    ? await brandRankingFromStore(LMARENA_SOURCE, parts.arena, parts.category, baselineDate)
    : []
  const official = officialRowsForConsensus(models)
    .map((m) => decodeBrandTableRanking(m.qualifierText))
    .filter((r) => r.length >= BRAND_TABLE_SIZE)
  const decodedActual = decodeActualTableOutcome(round.actual_outcome)
  const candidates = baseline.length ? candidateListFromRanking(baseline) : candidateListFromRanking(current)
  const actualNames = decodedActual.ranking.length
    ? mapActualBrandsToCandidates(decodedActual.ranking, candidates)
    : []
  const actualRows = actualNames.map((brand, i) => ({
    brand: brand as import('./ai-ranking/brands').MappedVendorBrand,
    model: '',
    rank: i + 1,
    score: null,
  }))
  const seatGrades =
    actualNames.length > 0
      ? officialRowsForConsensus(models)
          .map((m) => {
            const ranking = decodeBrandTableRanking(m.qualifierText)
            const predicted = ranking.length ? ranking : m.qualifierText ? [m.qualifierText] : []
            if (!predicted.length) return null
            return gradeBrandTableRanking(predicted, actualNames)
          })
          .filter((g): g is NonNullable<typeof g> => g != null)
      : null
  return buildBrandTableView({
    officialRankings: official,
    current,
    actual: actualRows.length ? actualRows : null,
    baseline: baseline.length ? baseline : null,
    seatGrades,
  })
}

async function loadSportsMarket(card: CardData, instrument: string) {
  const parts = decodeSportsInstrument(instrument)
  let marketBaselinePct: number | null = null
  if (parts) {
    const row = await readFixtureCache(parts.eventId)
    marketBaselinePct = subjectImpliedPct(row?.devigged_odds ?? null, subjectTeamOf(parts))
  }
  return buildSportsMarketView({ consensus: card.consensus, marketBaselinePct })
}
