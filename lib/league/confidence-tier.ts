/**
 * Confidence calibration tiers for ensemble and model confidence.
 *
 * Calibration law:
 *   < 60%  = 'close'
 *   60–79% = 'favored'
 *   ≥ 80%  = 'dominant'  ("압도" / "Dominant" — never below 80%)
 *
 * The card headline uses a finer four-band label (`confidence-strength.ts`).
 * This tier only gates the "압도" badge.
 *
 * Pure module — supports both 0..100 ledger probability and 0..1 unit scale.
 */

export type ConfidenceTier = 'close' | 'favored' | 'dominant'

export function ensembleConfidenceTier(
  probabilityOrConfidence: number | null | undefined,
): ConfidenceTier | null {
  if (probabilityOrConfidence == null || !Number.isFinite(probabilityOrConfidence)) return null
  const pct =
    probabilityOrConfidence <= 1 && probabilityOrConfidence > 0
      ? probabilityOrConfidence * 100
      : probabilityOrConfidence
  if (pct < 60) return 'close'
  if (pct < 80) return 'favored'
  return 'dominant'
}
