/**
 * AI Prediction League — CARD DATA CONTRACT (Layer 1).
 *
 * Pure types + tiny label maps. No DB access, no 'server-only' — this file is
 * safe to import from both server code (the API route, `card.ts`) and client
 * components (`components/league/*`) so there is exactly ONE definition of
 * what a card looks like.
 *
 * All AGGREGATES below (consensus / campSplit / tierSplit / hitRate) are
 * computed ONCE server-side by `buildCardData` in `card.ts`. Client code must
 * only ever READ these fields — never recompute tallies/averages from
 * `models` itself (that would risk drifting from the server's definition of
 * "majority" / "abstain" / "hit rate").
 */

import type { GradingState } from '../prediction/grading-state'
import type { VerdictPayload } from './verdict-aggregate'

export type { GradingState }
export type { VerdictPayload }

/**
 * Contract-neutral side token as stored in `model_predictions.predicted_direction`:
 * up|down (binary_close_higher), yes|no (binary_subject_outcome), above|below
 * (binary_threshold). Rendering words/glyphs come from the round's
 * (proposition_kind, subject_label, side) via `lib/league/side-labels.ts` —
 * never from this token alone.
 */
export type SideToken = 'up' | 'down' | 'yes' | 'no' | 'above' | 'below'

/**
 * What a model row's `direction` can hold: a contract side token, or the
 * legacy 'flat' (one grandfathered pre-hardening row shape; not writable —
 * see migration 20260829000002). 'flat' renders as its historical badge and
 * counts in the tally's `flat` slot, never as a side.
 */
export type ModelSide = SideToken | 'flat'

export type Direction = 'up' | 'down' | 'flat'
export type Camp = 'us' | 'china' | 'other'
export type LeagueTier = 'premier' | 'challenger' | 'world' | 'scout'
export type ColorBucket = 'green' | 'yellow' | 'red'

export const CAMPS: readonly Camp[] = ['us', 'china', 'other']
export const LEAGUE_TIERS: readonly LeagueTier[] = ['premier', 'challenger', 'world', 'scout']

export const CAMP_LABEL: Record<Camp, string> = {
  us: 'US',
  china: 'China',
  other: 'Other',
}

export const TIER_LABEL: Record<LeagueTier, string> = {
  premier: 'Premier',
  challenger: 'Challenger',
  world: 'World',
  scout: 'Scout',
}

/** One model's stored answer for this round, as read from `model_predictions`. */
export type CardModelPrediction = {
  /** `model_predictions.id` — needed to cache view-time rationale translations. */
  prediction_id: string | null
  model_id: string
  brand: string
  /** Roster slot id shown under the brand line so tiers are distinguishable. */
  model_identifier: string
  camp: Camp
  league_tier: LeagueTier
  /** null = abstained, timed out, errored, or parse failure. Otherwise the round's own side token (see `SideToken`). */
  direction: ModelSide | null
  /** 0-100 confidence/probability, or null. */
  probability: number | null
  /**
   * Expected signed percent change over the round's horizon (positive for
   * up, negative for down), or null. binary_close_higher ONLY. DECORATION on
   * the direction call — never read by `roundHitRecord` /
   * `winRatePctForDisplay` / any verdict aggregate; those all take
   * `is_correct` alone. Null on rows predating this field, or where
   * validation failed and the model was recorded as an error (see
   * `lib/league/orchestrator.ts`).
   */
  magnitude: number | null
  /**
   * Display-only TEXT qualifier for non-price contracts (scoreline "2-1",
   * vote margin, predicted print). Same negative guarantees as `magnitude`:
   * never graded, never in a hit fraction, never carries ✓/✗. Null on
   * close_higher rows (their qualifier is `magnitude`).
   */
  qualifierText: string | null
  reasoning_snippet: string | null
  /** null = round not yet resolved / this row not yet graded. */
  is_correct: boolean | null
  cost_usd: number | null
  predicted_at: string
}

/**
 * SLOT-shaped side tally. Field names are historical (wire/JSON compatible):
 * `up` counts the round's side A (up / yes / above — first token of its
 * contract pair), `down` counts side B (down / no / below). `flat` only ever
 * counts the grandfathered legacy row shape. Rendering maps slots back to the
 * round's own words/glyphs via `lib/league/side-labels.ts`.
 */
export type DirectionTally = { up: number; down: number; flat: number; abstain: number }

export function emptyTally(): DirectionTally {
  return { up: 0, down: 0, flat: 0, abstain: 0 }
}

export type ConsensusSummary = {
  tally: DirectionTally
  /** Majority vote among the two side slots (side token), or legacy 'flat'; null when tied or empty. */
  majorityDirection: ModelSide | null
  totalModels: number
  /** totalModels − abstain. */
  respondedModels: number
  /**
   * Mean stated probability among directional responses (majority method).
   * Kept for retrospective comparison with `aggregateProbability`.
   */
  avgProbability: number | null
  /**
   * Confidence-weighted log-odds aggregate direction — one of the round's two
   * side tokens (up/down, yes/no, above/below). This is what the user-facing
   * headline uses for direction + probability. Method name is never shown in UI.
   */
  aggregateDirection: SideToken | null
  /** Confidence in `aggregateDirection` after inverse-logit, 0–100. */
  aggregateProbability: number | null
  /**
   * Median expected magnitude among models whose OWN direction matches
   * `aggregateDirection` (median, not mean — outlier-robust; see
   * `lib/league/magnitude.ts`'s `aggregateMagnitude`). Null when no
   * direction-agreeing model reported a usable magnitude. A QUALIFIER on the
   * headline direction — never a graded figure, never in a hit fraction.
   */
  aggregateMagnitudePct: number | null
  /** How many models fed `aggregateMagnitudePct`. 0 when it is null. */
  aggregateMagnitudeN: number
}

export type CampSplit = Record<Camp, DirectionTally>
export type TierSplit = Record<LeagueTier, DirectionTally>

/** Grading status. Fields stay null until the round's reconciliation job runs. */
export type HitRateSummary = {
  resolved: boolean
  /** Number of models whose is_correct is not null. This is the sample size `n`. */
  graded: number
  correct: number | null
  /**
   * Null until `graded` reaches the minimum sample (see `lib/league/win-rate.ts`)
   * — a badge reading "100%" off two graded models is exactly the claim that
   * gate exists to prevent. Below it the card shows the raw record instead,
   * which `correct` + `graded` still support.
   */
  hitRatePct: number | null
  /** true while `graded` is below the minimum sample (equivalently: `hitRatePct === null`). */
  provisional: boolean
}

/**
 * Track record of the COMBINED method (40-model majority vote treated as
 * one predictor) across already-resolved graded rounds. Citation / past
 * accuracy — never advice. `n` is the number of resolved rounds that had
 * a clear majority, not the number of models.
 */
export type CombinedMethodTrack = {
  correct: number
  resolved: number
  n: number
  winRatePct: number | null
  provisional: boolean
}

export function emptyCombinedTrack(): CombinedMethodTrack {
  return { correct: 0, resolved: 0, n: 0, winRatePct: null, provisional: true }
}

export type CardRoundMeta = {
  round_id: string
  instrument: string
  category: string
  horizon: string
  resolution_rule: string
  proposition_text: string
  /**
   * Which answer contract this round runs under
   * ('binary_close_higher' | 'binary_subject_outcome' | 'binary_threshold').
   * Drives every side word/glyph on every surface via
   * `lib/league/side-labels.ts`. Rounds predating the column (or unknown
   * values) are close_higher — every pre-kind round is a price round.
   */
  proposition_kind: string
  /**
   * Display name of the NAMED subject for binary_subject_outcome rounds
   * ("Manchester United", "Candidate A"), or the threshold display string for
   * binary_threshold rounds. Null on price rounds. Server-composed by the
   * adapter — never user text.
   */
  subject_label: string | null
  color_bucket: ColorBucket
  resolves_at: string
  opened_at: string
  resolved_at: string | null
  actual_outcome: string | null
  /**
   * WHICH KIND OF UNGRADED this round is: 'not_due' | 'due_ungraded' |
   * 'grading' | 'graded' | 'unresolvable' (see
   * `lib/prediction/grading-state.ts`). `actual_outcome === null` alone cannot
   * tell a reader whether the deadline has not passed yet, whether grading is
   * running right now, or whether grading was attempted and refused — the UI
   * must say which rather than showing a blank result.
   */
  gradingState: GradingState
  /**
   * Why the last grading attempt refused, when `gradingState` is
   * 'unresolvable' (e.g. 'missing_anchor', 'no_session_in_window',
   * 'equal_close'). Null in every other state.
   */
  unresolvableReason: string | null
  /**
   * Instrument price AT ROUND-OPEN time (what makes a model's up/down call
   * legible) — persisted once, at creation, from the same market-data packet
   * used to build the model prompts (see `orchestrator.ts`'s
   * `persistAnchorPrice`). Null for rounds created before this field existed,
   * or when the price feed was unavailable at open time. PRESENTATION ONLY —
   * never read by grading/reconciliation.
   */
  anchorPrice: number | null
  /** Timestamp `anchorPrice` was observed. Null iff `anchorPrice` is null. */
  anchorPriceAt: string | null
  /**
   * UTC-dated session whose close is `anchorPrice`. THE date the audit
   * sentence may name. Never inferred from `anchorPriceAt`.
   */
  anchorSessionDate: string | null
  /**
   * UTC-dated session the round was graded against (`resolution_session_date`).
   * Null until graded. Never inferred from `resolves_at`.
   */
  resolutionSessionDate: string | null
  /**
   * The close the round was GRADED against (`resolution_price`). Null until
   * graded. PRESENTATION ONLY — pairs with `resolutionSessionDate` in the audit
   * sentence so the resolved close is named, never re-derived from a live quote.
   */
  resolutionPrice: number | null
  /**
   * Best-effort CURRENT quote, computed at read time (not stored) via a
   * short-TTL, in-process cache shared across all requests — see
   * `lib/league/live-price-cache.ts`. Always null on a cold cache entry, a
   * provider error/timeout/rate-limit, or a non-price category; never blocks
   * or slows down the card read path. Secondary to `anchorPrice`. The header
   * MUST NOT render this until `anchorPrice` is present — a live quote
   * standing alone is the wrong number for reading the forecasts against.
   */
  livePrice: number | null
  /** Timestamp `livePrice` was observed. Null iff `livePrice` is null. */
  livePriceAt: string | null
  /**
   * Actual realized percent change over the round (resolution close vs
   * anchor close), for the post-grading "predicted vs actual" comparison.
   * Derived from `anchorPrice`/`resolutionPrice` — never a separate stored
   * fact, so it can never disagree with what the header already names. Null
   * until both prices exist (i.e. until graded). PRESENTATION ONLY: grading
   * itself (`lib/prediction/resolution.ts`) decides up/down from the sign of
   * this same difference, never this percent value, and no hit/win-rate
   * calculation reads it.
   */
  actualMagnitudePct: number | null
  /**
   * Operator-evidence row when this round was graded from a published URL
   * (never the observed fact — that stays off the public card). Null on
   * every price-path round and on operator_manual rounds still waiting.
   */
  operatorEvidence: { sourceUrl: string; gradedAt: string } | null
}

/**
 * The full, self-contained shape a prediction card renders from. Everything a
 * component needs — no follow-up fetches, no client-side aggregation.
 */
export type CardData = {
  round: CardRoundMeta
  models: CardModelPrediction[]
  consensus: ConsensusSummary
  campSplit: CampSplit
  tierSplit: TierSplit
  hitRate: HitRateSummary
  /**
   * Final-verdict panel payload — raw counts only (see
   * `lib/league/verdict-aggregate.ts`). Computed once with the other
   * aggregates so the panel never recomputes a ratio itself.
   */
  verdict: VerdictPayload
  /**
   * Past accuracy of the 40-model majority-vote method. Empty/provisional
   * until enough ranked rounds have resolved. Attached by the card read
   * path; `buildCardData` defaults it to an empty track.
   */
  combinedTrack: CombinedMethodTrack
  /** ISO timestamp this snapshot was assembled — lets the UI show "as of". */
  generatedAt: string
}
