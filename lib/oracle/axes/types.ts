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

export type SpaceConfidence = {
  weight: ConfidenceWeight
  basis: ConfidenceBasis
}

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
    phase: SpaceConfidence | null
  }
  unreadable: UnreadableEntry[]
  reasons: AxisReasons
  engineVersion: string
}

export type PhaseVerdict = 'consensus' | 'lean' | 'split' | 'clash'

export type PhaseOpposition = {
  a: SystemId
  b: SystemId
  gap: number
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

export type PhaseConsensus = {
  tally: PhaseVector
  leader: PhaseAxis
  verdict: PhaseVerdict
  oppositions: PhaseOpposition[]
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
