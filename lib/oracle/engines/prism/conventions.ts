/**
 * Fixed, versioned conventions for the pure PRISM-5 engine.
 *
 * Axis normalization
 * ------------------
 * Raw MBTI letter deltas do not share a common spread (Relation ≈ 44 points
 * across the 16 types, Stability ≈ 36). A 0.65 weight on an un-normalized
 * Relation axis would dominate a 0.65 weight on Stability.
 *
 * Method (explicit): for each axis independently, take the population of
 * 16 raw MBTI vectors, compute mean μ and sample standard deviation σ,
 * then map
 *
 *     normalized = 50 + (raw - μ) * (TARGET_SD / σ)
 *
 * with TARGET_SD = 12, then clamp to [0, 100]. Identity-color projections
 * use the same target (μ, σ from the 24 remapped color vectors). Season
 * and weekday rhythm vectors are authored already on this common scale
 * (center 50, modest amplitude) and are not re-normalized.
 *
 * Timezone
 * --------
 * Input is date-only. Season element and weekday are resolved at local
 * noon in PRISM_TIMEZONE via the calendar engine (no solar-term reimplementation).
 *
 * Annual cycle
 * ------------
 * Rolls on the birthday, not 1 January. Day-31 / Feb-29 births clamp the
 * anniversary to the last civil day of that month.
 *
 * Conflict & concordance rescale (v1.1.0 tuning pass)
 * ----------------------------------------------------
 * `docs/prism-distribution.md` (v1.0.0 run) showed shadowPressure compressed
 * into 0–30 and concordance compressed into 80–100: the 24-color table has
 * only 276 unique unordered pairs (24 choose 2), and raw RMS color distance
 * never spans the full 0–100 range those pairs could theoretically produce.
 *
 * Fix: `currentConflict` is the raw impulse/need RMS color distance,
 * min-max rescaled against the EXACT empirical min/max RMS distance over
 * all 276 color pairs (`COLOR_CONFLICT_BOUNDS` in tables.ts, computed once
 * at module load — not hardcoded). The single closest pair now scores ~0,
 * the single farthest pair ~100.
 *
 * `concordance` no longer measures absolute distance between the identity
 * projection and coreMatrix (both are normalized to mean 50 / SD 12, so
 * distance is inherently compressed). It measures shape similarity instead:
 * Pearson correlation over the 6 paired (identity, core) axis values,
 * mapped from [-1, 1] to [0, 100] via `(r + 1) * 50`. This is invariant to
 * adding a constant to every axis of either vector — a deliberate property,
 * since a uniformly "louder" or "quieter" core profile with the same shape
 * as identity should still read as concordant.
 *
 * shadowPressure keeps its original weights on the rescaled conflict and
 * the correlation-based concordance:
 *     shadowPressure = currentConflict * 0.60 + (100 - concordance) * 0.40
 *
 * Domain star rating (v1.1.0 — replaces the v1.0.0 averaged overall star)
 * ------------------------------------------------------------------------
 * v1.0.0 computed one star from the mean of all five domain scores, which
 * made 1★ and 5★ mathematically unreachable (averaging five independent
 * scores collapses variance). Stars are now computed PER DOMAIN from that
 * domain's own score:
 *   <30 → 1★, <45 → 2★, <60 → 3★, <80 → 4★, else 5★.
 * A score ≥ 90 additionally sets a `peak` marker (spec: "90+ adds a PEAK
 * marker") on top of its (always 5★) rating.
 * `opportunityDomain` / `warningDomain` (v1.2.1) map to OPPORTUNITY and WARNING
 * output sections: highest and lowest domain scores respectively.
 * `headlineDomain` is a deprecated alias of `opportunityDomain` (formerly the
 * domain with largest |score−50|, which could surface a negative domain).
 */
export const PRISM_ENGINE_VERSION = '1.2.1'

export const PRISM_TIMEZONE = 'Asia/Seoul'

export const CORE_WEIGHTS = {
  mbti: 0.65,
  identity: 0.2,
  rhythm: 0.1,
  season: 0.05,
} as const

export const SHADOW_WEIGHTS = {
  conflict: 0.6,
  discord: 0.4,
} as const

/** Common-scale target after z-score affine map. */
export const AXIS_TARGET_MEAN = 50
export const AXIS_TARGET_SD = 12

/** Raised from ±8 in v1.0.0 to widen domain-score spread (v1.1.0 FIX 3). */
export const COLOR_STATE_CLAMP = 13
export const MBTI_AFFINITY_CLAMP = 13

export const DOMAIN_SCORE_MIN = 0
export const DOMAIN_SCORE_MAX = 100

export const LOW_BAND_THRESHOLD = 45

export const STACK_SIGNAL_MIN = 2
export const STACK_COLOR_HIGH = 70
export const STACK_CORE_HIGH = 62
export const STACK_RHYTHM_HIGH = 60
export const STACK_CONFLICT_HIGH = 55

export type DomainStar = 1 | 2 | 3 | 4 | 5

/** Spec bands: 0-29 1★ / 30-44 2★ / 45-59 3★ / 60-79 4★ / 80-100 5★. */
export const DOMAIN_STAR_BANDS = [30, 45, 60, 80] as const

/** 90+ adds a PEAK marker on top of (always 5★) rating. */
export const PEAK_THRESHOLD = 90

export function domainStarRating(score: number): DomainStar {
  if (score < DOMAIN_STAR_BANDS[0]) return 1
  if (score < DOMAIN_STAR_BANDS[1]) return 2
  if (score < DOMAIN_STAR_BANDS[2]) return 3
  if (score < DOMAIN_STAR_BANDS[3]) return 4
  return 5
}

export function isPeak(score: number): boolean {
  return score >= PEAK_THRESHOLD
}
