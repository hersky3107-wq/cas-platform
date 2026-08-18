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
  model_id: string
  brand: string
  camp: Camp
  league_tier: LeagueTier
  /** null = abstained, timed out, errored, or parse failure. */
  direction: Direction | null
  /** 0-100 confidence/probability, or null. */
  probability: number | null
  reasoning_snippet: string | null
  /** null = round not yet resolved / this row not yet graded. */
  is_correct: boolean | null
  cost_usd: number | null
  predicted_at: string
}

export type DirectionTally = { up: number; down: number; flat: number; abstain: number }

export function emptyTally(): DirectionTally {
  return { up: 0, down: 0, flat: 0, abstain: 0 }
}

export type ConsensusSummary = {
  tally: DirectionTally
  /** null when tied or when every model abstained. */
  majorityDirection: Direction | null
  totalModels: number
  /** totalModels − abstain. */
  respondedModels: number
  /** Average `probability` among directional (non-abstain) responses, 0-100, or null. */
  avgProbability: number | null
}

export type CampSplit = Record<Camp, DirectionTally>
export type TierSplit = Record<LeagueTier, DirectionTally>

/** Grading status. Fields stay null until the round's reconciliation job runs. */
export type HitRateSummary = {
  resolved: boolean
  /** Number of models whose is_correct is not null. */
  graded: number
  correct: number | null
  hitRatePct: number | null
}

/**
 * Track record of the COMBINED method (40-model majority vote treated as
 * one predictor) across already-resolved ranked rounds. Citation / past
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
  color_bucket: ColorBucket
  resolves_at: string
  opened_at: string
  resolved_at: string | null
  actual_outcome: string | null
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
   * Past accuracy of the 40-model majority-vote method. Empty/provisional
   * until enough ranked rounds have resolved. Attached by the card read
   * path; `buildCardData` defaults it to an empty track.
   */
  combinedTrack: CombinedMethodTrack
  /** ISO timestamp this snapshot was assembled — lets the UI show "as of". */
  generatedAt: string
}
