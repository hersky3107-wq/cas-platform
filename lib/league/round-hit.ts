/**
 * THE ONLY function that turns a round's model rows into a hit figure.
 *
 * Only rows with a persisted `is_correct` (true or false) enter the
 * denominator. A directional call that has not been stamped is not a miss
 * and is not a hit — counting it as either is how "72.5% (n=40)" and
 * "72.9% (n=37)" appeared for the same round.
 */

export type RoundHitRecord = {
  correct: number
  graded: number
}

export function roundHitRecord(models: readonly { is_correct: boolean | null }[]): RoundHitRecord {
  let correct = 0
  let graded = 0
  for (const m of models) {
    if (m.is_correct === null) continue
    graded += 1
    if (m.is_correct === true) correct += 1
  }
  return { correct, graded }
}
