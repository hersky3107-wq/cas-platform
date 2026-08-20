export { AXES_LAYER_VERSION, ELEMENT_BASELINE, PHASE_CLASH_END, PHASE_CONSENSUS_MIN, PHASE_LEAN_MIN, TRAIT_CONTESTED_SPREAD } from './conventions'
export { computeConsensus, syntheticVote } from './consensus'
export { centeredTraits, clamp100, normalizeElements, normalizePhase, normalizeTo100, reflectTraitMix } from './math'
export { assertValidVote, validateAxisVote } from './validate'
export { projectSaju } from './projectors/saju'
export { projectAstro } from './projectors/astro'
export { projectPrism, projectPrismResult } from './projectors/prism'
export { projectZiwei } from './projectors/ziwei'
export { projectNineStar } from './projectors/nine-star'
export { projectSukuyou } from './projectors/sukuyou'
export { projectMaya } from './projectors/maya'
export { projectTarot } from './projectors/tarot'
export { projectRune } from './projectors/rune'
export { projectIching } from './projectors/iching'
export { projectNumerology } from './projectors/numerology'
export { projectName } from './projectors/name'

export type { SajuProjectorInput } from './projectors/saju'
export type { AstroProjectorInput } from './projectors/astro'
export type { ZiweiProjectorInput } from './projectors/ziwei'
export type { NineStarProjectorInput } from './projectors/nine-star'
export type { SukuyouProjectorInput } from './projectors/sukuyou'
export type { MayaProjectorInput } from './projectors/maya'
export type { TarotProjectorInput } from './projectors/tarot'
export type { RuneProjectorInput } from './projectors/rune'
export type { IchingProjectorInput } from './projectors/iching'
export type { NumerologyProjectorInput } from './projectors/numerology'
export type { NameProjectorInput } from './projectors/name'

export type {
  AxisConsensus,
  AxisReasons,
  AxisSpace,
  AxisVote,
  ConfidenceBasis,
  ConfidenceWeight,
  ConsensusSystemCount,
  ElementAxis,
  ElementConsensus,
  ElementVector,
  PhaseAxis,
  PhaseConsensus,
  PhaseOpposition,
  PhaseVector,
  PhaseVerdict,
  SpaceConfidence,
  SystemId,
  TraitAxis,
  TraitConsensus,
  TraitVector,
  UnreadableEntry,
} from './types'
export { ELEMENT_AXES, PHASE_AXES, SYSTEM_IDS, TRAIT_AXES } from './types'
