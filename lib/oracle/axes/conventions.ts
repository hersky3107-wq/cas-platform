/**
 * Named thresholds for the axis layer. Do not inline these at call sites.
 */

import type {
  ConfidenceBasis,
  ConfidenceWeight,
  PhaseSpaceConfidence,
  PhaseTimescale,
  ReadingScope,
  SystemId,
} from './types'

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
/** Set from the 40k-subject distribution simulation (spread 10 → 11). */
export const TRAIT_CONTESTED_SPREAD = 11

/**
 * Retained for reference only — NOT used in consensus output or UI.
 * Simulation (40k subjects): full-12 mean leader ~44%; core subset 47.6%
 * with 2.2% five-system unanimity; saju+ziwei disagree 64% when both vote.
 * There is no verdict label to show; see `PhaseConsensus` in types.ts.
 */
/** @deprecated unused — do not wire to UI */
export const PHASE_CONSENSUS_MIN = 60
/** @deprecated unused — do not wire to UI */
export const PHASE_LEAN_MIN = 45

/**
 * A system sits on an "end" of the phase axis when this pole is at least
 * this share of its own (already-normalized) phase vector. Used only for
 * `oppositions` annotation ("사주 advances, 육효 releases"), not verdict.
 */
export const PHASE_CLASH_END = 60

/**
 * `polarized` is true when the weighted phase tally is bimodal on the two
 * action poles — advance and release both strong, hold weak — regardless
 * of whether any individual system pair crosses PHASE_CLASH_END.
 */
export const PHASE_POLARIZED_ADVANCE_MIN = 30
export const PHASE_POLARIZED_RELEASE_MIN = 30
export const PHASE_POLARIZED_HOLD_MAX = 30

/**
 * Table-lookup projectors used to emit 100/0/0 phase vectors — claiming
 * total certainty from a single symbol. `softenPhase` (math.ts) replaces
 * that with these shares instead; dominant axis unchanged, confidence
 * reduced. Residual weight tilts toward `hold` (the natural fallback)
 * when hold is not the dominant pole; when hold IS dominant, the residual
 * splits evenly between advance and release.
 *
 * Judgement call — chosen so a lone table verdict still leads clearly
 * (70% or 55%) without forcing every opposite-pole pair to register as
 * a structural "clash". Values will be revisited if a future simulation
 * shows leader shares still too concentrated.
 */
export const PHASE_SOFTEN_STRONG = { dominant: 70, holdResidual: 20, otherResidual: 10 } as const
export const PHASE_SOFTEN_MODERATE = { dominant: 55, holdResidual: 30, otherResidual: 15 } as const

/** Balanced 오행 baseline — each element is 20% of a 100-sum vector. */
export const ELEMENT_BASELINE = 20

export const DIRECT_WEIGHT = 1 as const
export const HALF_WEIGHT = 0.5 as const

/**
 * Phase timescale per projector — the DOMINANT clock when a system blends
 * several (comment where non-obvious). Traits and elements are timeless;
 * only phase carries `timescale`.
 */
/**
 * Life-period core: systems that actually read multi-year cycles.
 * ninestar is included for its 년반 (annual) component even though the
 * projector's *emitted* dominant timescale is daily (일盤 50%). Daily
 * mansions and draw oracles stay out — they have no standing on a life period.
 */
export const PHASE_CORE_SYSTEMS = ['saju', 'ziwei', 'prism', 'numerology', 'ninestar'] as const
export type PhaseCoreSystem = (typeof PHASE_CORE_SYSTEMS)[number]

/** The only two true `era` readers (대운 / 大限). */
export const PHASE_ERA_CORE_SYSTEMS = ['saju', 'ziwei'] as const

export const PHASE_TIMESCALE: Record<SystemId, PhaseTimescale> = {
  saju: 'era', // 대운 leads; 세운 (annual) is blended in but decade-scale dominates
  astro: 'daily', // applying transits at asOf — momentary sky, not in the task list but clearly daily
  prism: 'annual', // 12-cycle annual 70% + monthly 30%; annual is the named signal
  ziwei: 'era', // 大限 over 流年 liunian in the decade/year blend
  numerology: 'annual', // personal year
  name: 'daily', // phase unreadable; placeholder only
  iching: 'draw',
  tarot: 'draw',
  runes: 'draw',
  ninestar: 'daily', // phase day 50% / month 30% / year 20% — 일반 component dominates
  sukuyou: 'daily', // mansion relation for the current day
  tzolkin: 'daily', // tone-of-day / current kin
}

/**
 * How much each timescale contributes under a reading scope. Multiplies
 * the projector's existing confidence weight in phase aggregation only.
 * Judgement call — tune from the distribution simulation.
 */
export const PHASE_SCOPE_WEIGHT: Record<ReadingScope, Record<PhaseTimescale, number>> = {
  life: { era: 1.0, annual: 1.0, daily: 0.3, draw: 0.3 },
  today: { era: 0.3, annual: 0.5, daily: 1.0, draw: 0.5 },
  question: { era: 0.5, annual: 0.5, daily: 0.5, draw: 1.0 },
}

export function phaseConfidence(
  system: SystemId,
  weight: ConfidenceWeight,
  basis: ConfidenceBasis,
): PhaseSpaceConfidence {
  return { weight, basis, timescale: PHASE_TIMESCALE[system] }
}
