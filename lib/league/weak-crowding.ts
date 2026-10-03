/**
 * Weak-confidence crowding badge. Head-count skew with a low weighted
 * confidence — the headline count line stays unchanged; this only decides
 * whether the muted badge renders beside it.
 *
 * Majority share is max(side) / answered official seats (up + down).
 * Weighted confidence is `aggregateProbability` on a 0–100 scale, compared
 * as a fraction against WEAK_CONFIDENCE_CROWDING_MAX_WEIGHTED_CONFIDENCE.
 */

export const WEAK_CONFIDENCE_CROWDING_MAJORITY_SHARE = 0.85
export const WEAK_CONFIDENCE_CROWDING_MAX_WEIGHTED_CONFIDENCE = 0.62

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
    input.weightedConfidencePct / 100 < WEAK_CONFIDENCE_CROWDING_MAX_WEIGHTED_CONFIDENCE
  )
}
