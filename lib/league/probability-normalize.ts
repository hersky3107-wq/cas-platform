/**
 * Binary-seat probability: confidence that YOUR chosen side happens (50–100).
 * A value below 50 is treated as P(the other side) — the Haiku "22% on 불발"
 * case, where the model reported P(yes) instead of confidence in its pick.
 * Exactly 50 stays 50. Pure.
 */

export type NormalizedChosenProbability = {
  probability: number | null
  probabilityFlipped: boolean
}

export function normalizeChosenSideProbability(raw: number | null): NormalizedChosenProbability {
  if (raw == null || !Number.isFinite(raw)) return { probability: null, probabilityFlipped: false }
  const p = Math.max(0, Math.min(100, Math.round(raw)))
  if (p === 50) return { probability: 50, probabilityFlipped: false }
  if (p < 50) return { probability: 100 - p, probabilityFlipped: true }
  return { probability: p, probabilityFlipped: false }
}
