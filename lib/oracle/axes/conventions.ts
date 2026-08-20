/**
 * Named thresholds for the axis layer. Do not inline these at call sites.
 */

/** Projection-layer version. Bump when a projector formula or aggregator rule changes. */
export const AXES_LAYER_VERSION = '1.0.0'

/**
 * Trait axis whose weighted SD of CENTERED profiles exceeds this is marked
 * `contested` (see `math.ts` `centeredTraits` and `consensus.ts`
 * `traitConsensus`). Centering removes each vote's own 6-axis mean before
 * computing spread, so a pure scale/offset mismatch between systems (e.g.
 * prism's mean-50/SD-12 normalization vs saju/astro's raw 0-100 shares)
 * never trips this — only genuine disagreement about which axes a person
 * leans into does.
 *
 * The old value (15) was tuned for RAW trait spread, before centering
 * existed, and is NOT reusable here: centered spreads run much smaller
 * because the level differences are gone. 10 is chosen from the Part-1
 * worked example, where the three real votes' centered per-axis spreads
 * ran ~0.6–8.6; a threshold of 10 leaves room for that normal shape
 * variance while still catching an axis where systems genuinely point in
 * different directions.
 */
export const TRAIT_CONTESTED_SPREAD = 10

/**
 * Phase verdict bands, by leading share (of total weight). Three bands:
 *   consensus  leader >= PHASE_CONSENSUS_MIN (60)
 *   lean       leader >= PHASE_LEAN_MIN (45) and < PHASE_CONSENSUS_MIN
 *   split      leader < PHASE_LEAN_MIN
 * `clash` (see PHASE_CLASH_END below) overrides all three whenever a
 * >=60/>=60 opposite-pole pair exists, regardless of the leader's share.
 *
 * With 7 projectors the worked example gave hold 53.3 vs advance 32.4 —
 * a clear lean that the old binary consensus/split split mislabelled as
 * `split`. `lean` exists to name that middle case instead of collapsing
 * it into `split`.
 *
 * DO NOT retune these two numbers beyond adding this middle band. They are
 * placeholders — real thresholds will be set from a distribution simulation
 * once all 12 projectors exist and we can see the actual leader-share
 * distribution across many charts, not eyeballed from one worked example.
 */
export const PHASE_CONSENSUS_MIN = 60
export const PHASE_LEAN_MIN = 45

/**
 * A system sits on an "end" of the phase axis when this pole is at least
 * this share of its own (already-normalized) phase vector.
 */
export const PHASE_CLASH_END = 60

/** Balanced 오행 baseline — each element is 20% of a 100-sum vector. */
export const ELEMENT_BASELINE = 20

export const DIRECT_WEIGHT = 1 as const
export const HALF_WEIGHT = 0.5 as const
