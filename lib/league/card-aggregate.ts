import {
  CAMPS,
  LEAGUE_TIERS,
  emptyTally,
  type CampSplit,
  type CardData,
  type CardModelPrediction,
  type CardRoundMeta,
  type ColorBucket,
  type ConsensusSummary,
  type DirectionTally,
  type ModelSide,
  emptyCombinedTrack,
  type CombinedMethodTrack,
  type HitRateSummary,
  type TierSplit,
} from './card-types'
import { sidePairOf, tallySlotOfToken, toSideToken, type SideRoundContext } from './side-labels'
import type { AnswerSide } from './answer-contract'
import { gradingStateOf, type GradingState } from '../prediction/grading-state'
import { formatRosterBrand, lookupRosterEntry, rosterModelIdentifier, LEAGUE_ROSTER } from './roster'
import { isDisplayableWinRate, winRatePctForDisplay } from './win-rate'
import { roundHitRecord } from './round-hit'
import { normalizeSessionDate } from '../prediction/resolution'
import { brandCountry } from './country'
import {
  bookFromTier,
  buildVerdictPayload,
  type VerdictCrossRoundGrade,
  type VerdictPayload,
  type VerdictRosterMeta,
} from './verdict-aggregate'
import { binaryCallsFromModels, dualConsensus } from './log-odds-consensus'
import { aggregateMagnitude, computeActualMagnitudePct } from './magnitude'

/**
 * AI Prediction League — CARD DATA CONTRACT (Layer 1), pure assembly.
 *
 * `round + predictions -> CardData`, with every aggregate the UI needs
 * (consensus / camp split / tier split / hit rate) computed exactly ONCE,
 * here, so the client never has to (and can't drift from this definition of
 * "majority" / "abstain" / "hit rate").
 *
 * Deliberately has NO 'server-only' import and NO DB access — it is pure
 * data-in/data-out, which is what makes it unit-testable with vitest without
 * a Supabase connection (see `__tests__/card.test.ts`). The actual DB read
 * path lives in `card.ts` (which IS 'server-only') and calls this function.
 */

export type RoundRow = {
  id: string
  proposition_text: string
  /**
   * Optional like the other late columns: rounds selected before the
   * 20260829000002 migration lack them. Unknown/absent kind = close_higher
   * (every pre-kind round is a price round).
   */
  proposition_kind?: string | null
  subject_label?: string | null
  category: string
  color_bucket: string
  instrument: string
  horizon: string
  resolution_rule: string
  resolves_at: string
  opened_at: string
  actual_outcome: string | null
  resolved_at: string | null
  /** Optional: absent on rows selected before this column existed (e.g. older scripts' explicit column lists) — treated as null. */
  anchor_price?: number | null
  anchor_price_at?: string | null
  /**
   * Grading-trigger columns (migration 20260821000002). Optional for the same
   * reason as the anchor pair: where they are absent the derived state falls
   * back to what `resolves_at` + `actual_outcome` alone can prove, which is
   * exactly the pre-migration behaviour.
   */
  grading_busy_until?: string | null
  grading_attempted_at?: string | null
  unresolvable_reason?: string | null
  anchor_session_date?: string | null
  resolution_session_date?: string | null
  resolution_price?: number | null
}

export type PredictionRow = {
  id?: string | null
  model_id: string
  brand: string
  camp: string
  league_tier: string
  predicted_direction: string | null
  predicted_value: number | null
  /** Optional: absent on rows selected before this column existed (pre-migration environments) — treated as null. */
  predicted_magnitude_pct?: number | null
  /** Optional for the same reason — display-only text qualifier (scoreline/margin/print) on non-price contracts. */
  predicted_qualifier_text?: string | null
  reasoning_snippet: string | null
  is_correct: boolean | null
  cost_usd: number | null
  predicted_at: string
}

function toColorBucket(raw: string): ColorBucket {
  return raw === 'green' || raw === 'yellow' || raw === 'red' ? raw : 'yellow'
}

/** Slot-shaped tally: side A rows land in `up`, side B in `down` (see `DirectionTally`'s doc). */
function tallyOf(models: CardModelPrediction[]): DirectionTally {
  const t = emptyTally()
  for (const m of models) {
    const slot = tallySlotOfToken(m.direction)
    if (slot === null) t.abstain++
    else t[slot]++
  }
  return t
}

/**
 * Majority among the round's OWN side tokens (plus legacy 'flat'), counted
 * from the rows directly — a round's rows only ever carry its contract's
 * pair, so the winner is naturally that round's vocabulary. Null on tie or
 * when nobody answered.
 */
function majorityOf(models: CardModelPrediction[]): ModelSide | null {
  const counts = new Map<ModelSide, number>()
  for (const m of models) {
    if (m.direction === null) continue
    counts.set(m.direction, (counts.get(m.direction) ?? 0) + 1)
  }
  let top: ModelSide | null = null
  let topCount = 0
  let tied = false
  for (const [side, count] of counts) {
    if (count > topCount) {
      top = side
      topCount = count
      tied = false
    } else if (count === topCount) {
      tied = true
    }
  }
  return topCount > 0 && !tied ? top : null
}

function buildConsensus(models: CardModelPrediction[], sides: readonly [AnswerSide, AnswerSide]): ConsensusSummary {
  const tally = tallyOf(models)
  const directional = models.filter((m) => m.direction !== null)
  const probs = directional.map((m) => m.probability).filter((p): p is number => typeof p === 'number')
  const avgProbability = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : null
  const dual = dualConsensus(binaryCallsFromModels(models, sides), sides)
  const magnitude = aggregateMagnitude(models, dual.aggregate.direction)
  return {
    tally,
    majorityDirection: majorityOf(models),
    totalModels: models.length,
    respondedModels: models.length - tally.abstain,
    avgProbability: avgProbability === null ? null : Math.round(avgProbability * 10) / 10,
    aggregateDirection: dual.aggregate.direction,
    aggregateProbability: dual.aggregate.probability,
    aggregateMagnitudePct: magnitude.medianPct,
    aggregateMagnitudeN: magnitude.n,
  }
}

function buildCampSplit(models: CardModelPrediction[]): CampSplit {
  const split = {} as CampSplit
  for (const camp of CAMPS) split[camp] = tallyOf(models.filter((m) => m.camp === camp))
  return split
}

function buildTierSplit(models: CardModelPrediction[]): TierSplit {
  const split = {} as TierSplit
  for (const tier of LEAGUE_TIERS) split[tier] = tallyOf(models.filter((m) => m.league_tier === tier))
  return split
}

function buildHitRate(resolvedAt: string | null, models: CardModelPrediction[]): HitRateSummary {
  const { correct, graded } = roundHitRecord(models)
  return {
    resolved: resolvedAt !== null,
    graded,
    correct: graded ? correct : null,
    // Same minimum-sample gate as the leaderboard — see `./win-rate.ts`.
    hitRatePct: winRatePctForDisplay(correct, graded),
    provisional: !isDisplayableWinRate(graded),
  }
}

const VERDICT_ROSTER: readonly VerdictRosterMeta[] = LEAGUE_ROSTER.map((e) => ({
  model_id: e.model_id,
  camp: e.camp,
  country: brandCountry(e.brand, e.camp),
  tier: e.league_tier,
  book: bookFromTier(e.league_tier),
}))

function buildVerdict(
  models: CardModelPrediction[],
  roundId: string,
  crossRound?: readonly VerdictCrossRoundGrade[]
): VerdictPayload {
  return buildVerdictPayload({
    round: { id: roundId },
    predictions: models.map((m) => ({
      model_id: m.model_id,
      brand: m.brand,
      camp: m.camp,
      league_tier: m.league_tier,
      predicted_direction: m.direction,
      predicted_value: m.probability,
      is_correct: m.is_correct,
    })),
    roster: VERDICT_ROSTER,
    crossRound,
  })
}

export type CardAggregates = {
  consensus: ConsensusSummary
  campSplit: CampSplit
  tierSplit: TierSplit
  hitRate: HitRateSummary
  verdict: VerdictPayload
}

/**
 * The exact same aggregate definitions `buildCardData` uses, exposed
 * standalone so a LIVE view can recompute them for an in-memory `models`
 * array without ever re-implementing "majority" / "abstain" / "hit rate"
 * anywhere else (see `lib/league/use-card-stream.ts`'s live-merge path,
 * the ONE sanctioned caller of this outside `buildCardData` itself). This is
 * not a second source of truth — it is the SAME function, so a live view and
 * the next `GET /api/league/card` refetch can never define "majority"
 * differently; they can only ever differ in which `models` rows they were
 * given, and the DB-fetched set always wins once it arrives.
 */
export function computeCardAggregates(
  models: CardModelPrediction[],
  resolvedAt: string | null,
  opts?: {
    roundId?: string
    crossRound?: readonly VerdictCrossRoundGrade[]
    /**
     * The round the models belong to, for its side pair (consensus direction
     * tokens). Omitted = close_higher (up/down) — correct for every caller
     * that predates proposition_kind, wrong for a subject/threshold round, so
     * pass it whenever a round is in hand (`buildCardData` and the stream
     * hook both do).
     */
    round?: SideRoundContext
  }
): CardAggregates {
  const sides = sidePairOf(opts?.round ?? {})
  return {
    consensus: buildConsensus(models, sides),
    campSplit: buildCampSplit(models),
    tierSplit: buildTierSplit(models),
    hitRate: buildHitRate(resolvedAt, models),
    verdict: buildVerdict(models, opts?.roundId ?? '', opts?.crossRound),
  }
}

function toCardModel(row: PredictionRow): CardModelPrediction {
  const tier = row.league_tier as CardModelPrediction['league_tier']
  const camp = row.camp as CardModelPrediction['camp']
  const roster = lookupRosterEntry(row.model_id)
  return {
    prediction_id: row.id ?? null,
    model_id: row.model_id,
    brand: roster ? formatRosterBrand(roster) : row.brand,
    model_identifier: roster ? rosterModelIdentifier(roster) : row.model_id,
    camp,
    league_tier: tier,
    // toSideToken, not the old up/down/flat gate: yes/no/above/below rows
    // must land as answers, never as abstentions.
    direction: toSideToken(row.predicted_direction),
    probability: row.predicted_value,
    magnitude: row.predicted_magnitude_pct ?? null,
    qualifierText: row.predicted_qualifier_text ?? null,
    reasoning_snippet: row.reasoning_snippet,
    is_correct: row.is_correct,
    cost_usd: row.cost_usd,
    predicted_at: row.predicted_at,
  }
}

/**
 * Presentation-layer grading state. `gradingStateOf` is the ledger; this is
 * what the card is allowed to SHOW.
 *
 * A due round with no persisted `anchor_price` cannot be graded (the engine
 * refuses with `missing_anchor`). Painting that as 'grading' is what trapped
 * the AAPL card: every refresh re-fired grade-on-read, the attempt could not
 * persist a reason (and even when it can, the next optimistic paint overwrote
 * it), and the UI sat on "Grading…" forever. If we already know the attempt
 * will refuse, we say so.
 *
 * A live claim (`grading`) is left alone — that is a genuine in-flight grade.
 */
export function presentCardGrading(
  row: Pick<
    RoundRow,
    | 'resolves_at'
    | 'actual_outcome'
    | 'resolved_at'
    | 'anchor_price'
    | 'grading_busy_until'
    | 'grading_attempted_at'
    | 'unresolvable_reason'
    | 'proposition_kind'
  >,
  nowMs: number
): { gradingState: GradingState; unresolvableReason: string | null } {
  const gradingState = gradingStateOf(
    {
      resolves_at: row.resolves_at,
      actual_outcome: row.actual_outcome,
      resolved_at: row.resolved_at,
      grading_busy_until: row.grading_busy_until ?? null,
      grading_attempted_at: row.grading_attempted_at ?? null,
      unresolvable_reason: row.unresolvable_reason ?? null,
    },
    nowMs
  )
  const kind = row.proposition_kind ?? 'binary_close_higher'
  if (
    gradingState === 'due_ungraded' &&
    !hasUsableAnchor(row.anchor_price) &&
    kind === 'binary_close_higher'
  ) {
    return { gradingState: 'unresolvable', unresolvableReason: 'missing_anchor' }
  }
  return {
    gradingState,
    unresolvableReason: gradingState === 'unresolvable' ? (row.unresolvable_reason ?? null) : null,
  }
}

function hasUsableAnchor(price: number | null | undefined): boolean {
  return typeof price === 'number' && Number.isFinite(price)
}

function toRoundMeta(row: RoundRow, nowMs: number): CardRoundMeta {
  const { gradingState, unresolvableReason } = presentCardGrading(row, nowMs)
  return {
    round_id: row.id,
    instrument: row.instrument,
    category: row.category,
    horizon: row.horizon,
    resolution_rule: row.resolution_rule,
    proposition_text: row.proposition_text,
    proposition_kind: row.proposition_kind ?? 'binary_close_higher',
    subject_label: row.subject_label ?? null,
    color_bucket: toColorBucket(row.color_bucket),
    resolves_at: row.resolves_at,
    opened_at: row.opened_at,
    resolved_at: row.resolved_at,
    actual_outcome: row.actual_outcome,
    gradingState,
    unresolvableReason,
    anchorPrice: row.anchor_price ?? null,
    anchorPriceAt: row.anchor_price_at ?? null,
    anchorSessionDate: normalizeSessionDate(row.anchor_session_date ?? null),
    resolutionSessionDate: normalizeSessionDate(row.resolution_session_date ?? null),
    resolutionPrice: row.resolution_price ?? null,
    actualMagnitudePct: computeActualMagnitudePct(row.anchor_price ?? null, row.resolution_price ?? null),
    // Populated by `card.ts` after this pure function returns — see
    // `CardRoundMeta.livePrice`'s doc comment. Defaulting to null here keeps
    // this function's output fully deterministic/testable without network
    // access; `fetchCardData` is the only caller that overwrites these two.
    livePrice: null,
    livePriceAt: null,
    operatorEvidence: null,
  }
}

/** Pure assembly step: round + predictions -> CardData. No I/O. */
export function buildCardData(
  roundRow: RoundRow,
  predictionRows: PredictionRow[],
  combinedTrack: CombinedMethodTrack = emptyCombinedTrack(),
  crossRound?: readonly VerdictCrossRoundGrade[]
): CardData {
  const models = predictionRows.map(toCardModel)
  const nowMs = Date.now()
  return {
    round: toRoundMeta(roundRow, nowMs),
    models,
    ...computeCardAggregates(models, roundRow.resolved_at, {
      roundId: roundRow.id,
      crossRound,
      round: roundRow,
    }),
    combinedTrack,
    generatedAt: new Date().toISOString(),
  }
}
