/**
 * Weak-confidence crowding badge. High head-count skew with a low weighted
 * confidence. The badge sits beside the strength headline; the raw head
 * count is a smaller line and is not this badge.
 *
 * Majority share is max(side) / answered official seats (up + down).
 * Weighted confidence is `aggregateProbability` on a 0–100 scale.
 * The confidence ceiling matches the "철벽" rule (`IRON_MIN_CONFIDENCE_PCT`):
 * agreement at or above 85% with confidence under 70% is crowded, not iron.
 */

import { IRON_MIN_CONFIDENCE_PCT } from './sports-market'

export const WEAK_CONFIDENCE_CROWDING_MAJORITY_SHARE = 0.85
/** Same cutoff as 철벽: confidence at or above this is not "weak". */
export const WEAK_CONFIDENCE_CROWDING_MAX_WEIGHTED_CONFIDENCE = IRON_MIN_CONFIDENCE_PCT / 100

export function isWeakConfidenceCrowding(input: {
  up: number
  down: number
  /** Ensemble weighted confidence, 0–100. Null hides the badge. */
  weightedConfidencePct: number | null
}): boolean {
  const answered = input.up + input.down
  if (answered <= 0 || input.weightedConfidencePct == null || !Number.isFinite(input.weightedConfidencePct)) {
    return false
  }
  const share = Math.max(input.up, input.down) / answered
  return (
    share >= WEAK_CONFIDENCE_CROWDING_MAJORITY_SHARE &&
    input.weightedConfidencePct < IRON_MIN_CONFIDENCE_PCT
  )
}
