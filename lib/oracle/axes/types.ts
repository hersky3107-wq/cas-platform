/**
 * Axis projection contract.
 *
 * Three coordinate spaces every readable system is asked to vote in.
 * Projectors NEVER emit Korean/English prose — `reasons` and `unreadable`
 * are machine codes for the i18n layer.
 */

export const SYSTEM_IDS = [
  'saju',
  'astro',
  'prism',
  'ziwei',
  'numerology',
  'name',
  'iching',
  'tarot',
  'runes',
  'ninestar',
  'sukuyou',
  'tzolkin',
] as const

export type SystemId = (typeof SYSTEM_IDS)[number]

export const TRAIT_AXES = [
  'drive',
  'stability',
  'relation',
  'control',
  'exploration',
  'reflection',
] as const
export type TraitAxis = (typeof TRAIT_AXES)[number]
export type TraitVector = Record<TraitAxis, number>

export const ELEMENT_AXES = ['wood', 'fire', 'earth', 'metal', 'water'] as const
export type ElementAxis = (typeof ELEMENT_AXES)[number]
export type ElementVector = Record<ElementAxis, number>

export const PHASE_AXES = ['advance', 'hold', 'release'] as const
export type PhaseAxis = (typeof PHASE_AXES)[number]
export type PhaseVector = Record<PhaseAxis, number>

export type AxisSpace = 'traits' | 'elements' | 'phase'

/** How the projector obtained this space. The UI copy differs for each. */
export type ConfidenceBasis = 'direct' | 'derived' | 'degraded'

/** 1 = native full-weight vote; 0.5 = derived or degraded. */
export type ConfidenceWeight = 1 | 0.5

/** Which clock a projector reads phase on — used only in the phase space. */
export type PhaseTimescale = 'era' | 'annual' | 'daily' | 'draw'

export type SpaceConfidence = {
  weight: ConfidenceWeight
  basis: ConfidenceBasis
}

export type PhaseSpaceConfidence = SpaceConfidence & {
  timescale: PhaseTimescale
}

/** Which temporal lens the caller wants phase consensus weighted for. */
export type ReadingScope = 'life' | 'today' | 'question'

export type UnreadableEntry = {
  space: AxisSpace
  code: string
}

export type AxisReasons = {
  traits?: string[]
  elements?: string[]
  phase?: string[]
}

/**
 * One system's vote in the shared coordinate spaces.
 * `traits` / `elements` / `phase` are null when that space is unreadable.
 */
export type AxisVote = {
  system: SystemId
  traits: TraitVector | null
  elements: ElementVector | null
  phase: PhaseVector | null
  confidence: {
    traits: SpaceConfidence | null
    elements: SpaceConfidence | null
    phase: PhaseSpaceConfidence | null
  }
  unreadable: UnreadableEntry[]
  reasons: AxisReasons
  engineVersion: string
}

export type PhaseOpposition = {
  a: SystemId
  b: SystemId
  gap: number
}

/**
 * Phase aggregation for display. Intentionally has NO `verdict` field —
 * distribution simulation (40k subjects) showed there is no honest
 * consensus/lean/split headline to give:
 *   - full-12 mean leader share ~44%
 *   - core (era+annual) mean leader 47.6%, five-system unanimity 2.2%
 *   - saju+ziwei disagree 64% of the time when both vote
 * UI copy uses `unanimityCount` / `participantCount` ("12개 중 5개가 정리 쪽")
 * plus tally bars, `oppositions`, and `polarized`. Do NOT re-add verdict
 * from intuition — the numbers above are the reason.
 */
export type PhaseConsensus = {
  /** Full 12-system tally (scope-weighted). */
  tally: PhaseVector
  leader: PhaseAxis
  /** Leading share of `tally`, 0–100. */
  leaderShare: number
  /** Systems whose own dominant pole matches `leader`. */
  unanimityCount: number
  /** Systems that contributed a phase vote (weight > 0). */
  participantCount: number
  /**
   * Era + annual readers only (saju, ziwei, prism, numerology, ninestar),
   * confidence weight alone — no readingScope multiplier.
   */
  coreTally: PhaseVector
  /** Tally is bimodal: both action poles ≥30% and hold <30%. Screen flag only. */
  polarized: boolean
  oppositions: PhaseOpposition[]
  participating: SystemId[]
  unreadable: SystemId[]
}

export type TraitConsensus = {
  /** Raw weighted mean per axis, for display. Different systems' absolute
   * scales show up here — that is expected, not disagreement. */
  mean: TraitVector
  /** Weighted mean of each vote's CENTERED profile (own 6-axis mean
   * subtracted out first) — the shape, with scale/offset removed. */
  profile: TraitVector
  /** Weighted SD of the centered profiles, per axis. `contested` is
   * derived from this, never from raw `mean`. */
  spread: TraitVector
  contested: TraitAxis[]
  participating: SystemId[]
  unreadable: SystemId[]
}

export type ElementConsensus = {
  total: ElementVector
  /** Gap below the balanced 20% baseline; 0 when at or above. Talisman input. */
  deficiency: ElementVector
  excess: ElementVector
  participating: SystemId[]
  unreadable: SystemId[]
}

export type ConsensusSystemCount = {
  total: number
  participating: number
  partial: number
  unreadable: number
}

export type AxisConsensus = {
  traits: TraitConsensus
  elements: ElementConsensus
  phase: PhaseConsensus
  systemCount: ConsensusSystemCount
}
