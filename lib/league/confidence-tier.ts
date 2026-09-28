/**
 * Confidence calibration tiers for ensemble and model confidence.
 *
 * Calibration law:
 *   < 60%  = 'close'    ("접전" / "Close")
 *   60–75% = 'favored'  ("우세" / "Favored")
 *   > 75%  = 'dominant' ("압도" / "Dominant")
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
  if (pct <= 75) return 'favored'
  return 'dominant'
}
