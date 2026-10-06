/**
 * Display-only strength of the weighted call, and how sure each seat was
 * of the side it picked. Grading, records, and leaderboards do not read this.
 *
 * Headline bands (on the rounded weighted confidence, 0–100):
 *   ≥ 80  strong
 *   70–79 lead
 *   60–69 near
 *   < 60  toss
 *
 * Bar bands use each seat's own probability for its chosen side:
 *   ≥ 70 strong, otherwise weak. Side A is the up / yes / above slot.
 */

import type { ModelSide } from './card-types'
import { tallySlotOfToken } from './side-labels'

export type StrengthBand = 'strong' | 'lead' | 'near' | 'toss'

export type ConfidenceBandCounts = {
  strongA: number
  weakA: number
  weakB: number
  strongB: number
}

/** A seat is "strong" on its chosen side at or above this probability. */
export const STRONG_SEAT_PCT = 70

export function strengthBand(weightedConfidencePct: number): StrengthBand {
  if (weightedConfidencePct >= 80) return 'strong'
  if (weightedConfidencePct >= 70) return 'lead'
  if (weightedConfidencePct >= 60) return 'near'
  return 'toss'
}

export function confidenceBandCounts(
  seats: readonly { direction: ModelSide | string | null; probability: number | null }[],
): ConfidenceBandCounts {
  const bands: ConfidenceBandCounts = { strongA: 0, weakA: 0, weakB: 0, strongB: 0 }
  for (const seat of seats) {
    const slot = tallySlotOfToken(seat.direction as ModelSide | null)
    if (slot !== 'up' && slot !== 'down') continue
    const strong = typeof seat.probability === 'number' && seat.probability >= STRONG_SEAT_PCT
    if (slot === 'up') {
      if (strong) bands.strongA += 1
      else bands.weakA += 1
    } else if (strong) bands.strongB += 1
    else bands.weakB += 1
  }
  return bands
}
