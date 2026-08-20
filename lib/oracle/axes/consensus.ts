import {
  ELEMENT_BASELINE,
  PHASE_CLASH_END,
  PHASE_POLARIZED_ADVANCE_MIN,
  PHASE_POLARIZED_HOLD_MAX,
  PHASE_POLARIZED_RELEASE_MIN,
  PHASE_CORE_SYSTEMS,
  PHASE_SCOPE_WEIGHT,
  PHASE_TIMESCALE,
  TRAIT_CONTESTED_SPREAD,
} from './conventions'
import {
  centeredTraits,
  emptyElements,
  emptyPhase,
  emptyTraits,
  normalizeElements,
  normalizePhase,
  round1,
  weightedMean,
  weightedSd,
} from './math'
import {
  ELEMENT_AXES,
  PHASE_AXES,
  TRAIT_AXES,
  type AxisConsensus,
  type AxisVote,
  type ElementVector,
  type PhaseAxis,
  type PhaseOpposition,
  type PhaseVector,
  type PhaseTimescale,
  type ReadingScope,
  type SystemId,
  type TraitVector,
} from './types'

type WeightedSample = { x: number; w: number }

function dominantPhase(vector: PhaseVector): PhaseAxis {
  return PHASE_AXES.reduce((best, axis) => (vector[axis] > vector[best] ? axis : best), PHASE_AXES[0])
}

function phaseLeader(tally: PhaseVector): PhaseAxis {
  return dominantPhase(tally)
}

export type ComputeConsensusOptions = {
  /** Which temporal lens to weight phase votes for. Default `life`. */
  readingScope?: ReadingScope
}

function spaceWeight(vote: AxisVote, space: 'traits' | 'elements' | 'phase'): number {
  const conf = vote.confidence[space]
  return conf ? conf.weight : 0
}

function phaseWeight(vote: AxisVote, readingScope: ReadingScope): number {
  const conf = vote.confidence.phase
  if (!conf) return 0
  return conf.weight * PHASE_SCOPE_WEIGHT[readingScope][conf.timescale]
}

function partition(votes: AxisVote[], space: 'traits' | 'elements' | 'phase'): {
  participating: SystemId[]
  unreadable: SystemId[]
} {
  const participating: SystemId[] = []
  const unreadable: SystemId[] = []
  for (const vote of votes) {
    if (vote[space] !== null) participating.push(vote.system)
    else unreadable.push(vote.system)
  }
  return { participating, unreadable }
}

function traitConsensus(votes: AxisVote[]): AxisConsensus['traits'] {
  const { participating, unreadable } = partition(votes, 'traits')
  const mean = emptyTraits()
  const profile = emptyTraits()
  const spread = emptyTraits()

  // Raw weighted mean per axis, unchanged — for display only. Systems on
  // different absolute scales disagree here by construction; that is not
  // what `contested` measures.
  for (const axis of TRAIT_AXES) {
    const samples: WeightedSample[] = []
    for (const vote of votes) {
      if (!vote.traits) continue
      samples.push({ x: vote.traits[axis], w: spaceWeight(vote, 'traits') })
    }
    mean[axis] = round1(weightedMean(samples))
  }

  // Centered profile: each vote's own 6-axis mean is subtracted out first,
  // so only the SHAPE survives. `contested` is computed on this centered
  // scale so a scale/offset mismatch is never mistaken for disagreement.
  const centered = new Map<AxisVote, TraitVector>()
  for (const vote of votes) {
    if (vote.traits) centered.set(vote, centeredTraits(vote.traits))
  }

  for (const axis of TRAIT_AXES) {
    const samples: WeightedSample[] = []
    for (const vote of votes) {
      const c = centered.get(vote)
      if (!c) continue
      samples.push({ x: c[axis], w: spaceWeight(vote, 'traits') })
    }
    const axisProfile = weightedMean(samples)
    profile[axis] = round1(axisProfile)
    spread[axis] = round1(weightedSd(samples, axisProfile))
  }

  const contested = TRAIT_AXES.filter((axis) => spread[axis] > TRAIT_CONTESTED_SPREAD)
  return { mean, profile, spread, contested, participating, unreadable }
}

function elementConsensus(votes: AxisVote[]): AxisConsensus['elements'] {
  const { participating, unreadable } = partition(votes, 'elements')
  const raw = emptyElements()
  let any = false

  for (const vote of votes) {
    if (!vote.elements) continue
    const weight = spaceWeight(vote, 'elements')
    if (weight <= 0) continue
    any = true
    for (const axis of ELEMENT_AXES) {
      raw[axis] += vote.elements[axis] * weight
    }
  }

  const total: ElementVector = any ? (normalizeElements(raw) ?? emptyElements()) : emptyElements()
  const deficiency = emptyElements()
  const excess = emptyElements()
  if (any) {
    for (const axis of ELEMENT_AXES) {
      deficiency[axis] = round1(Math.max(0, ELEMENT_BASELINE - total[axis]))
      excess[axis] = round1(Math.max(0, total[axis] - ELEMENT_BASELINE))
    }
  }

  return { total, deficiency, excess, participating, unreadable }
}

export function computeCoreTally(votes: AxisVote[], systems: readonly SystemId[]): PhaseVector {
  const allowed = new Set<SystemId>(systems)
  const raw = emptyPhase()
  let any = false

  for (const vote of votes) {
    if (!allowed.has(vote.system) || !vote.phase) continue
    const weight = vote.confidence.phase?.weight ?? 0
    if (weight <= 0) continue
    any = true
    for (const axis of PHASE_AXES) {
      raw[axis] += vote.phase[axis] * weight
    }
  }

  return any ? (normalizePhase(raw) ?? emptyPhase()) : emptyPhase()
}

function buildPhaseTally(votes: AxisVote[], weightFn: (vote: AxisVote) => number): PhaseVector {
  const raw = emptyPhase()
  let any = false
  for (const vote of votes) {
    if (!vote.phase) continue
    const weight = weightFn(vote)
    if (weight <= 0) continue
    any = true
    for (const axis of PHASE_AXES) {
      raw[axis] += vote.phase[axis] * weight
    }
  }
  return any ? (normalizePhase(raw) ?? emptyPhase()) : emptyPhase()
}

function countPhaseParticipants(votes: AxisVote[], weightFn: (vote: AxisVote) => number): number {
  let count = 0
  for (const vote of votes) {
    if (!vote.phase) continue
    if (weightFn(vote) > 0) count += 1
  }
  return count
}

function countPhaseUnanimity(votes: AxisVote[], leader: PhaseAxis, weightFn: (vote: AxisVote) => number): number {
  let count = 0
  for (const vote of votes) {
    if (!vote.phase) continue
    if (weightFn(vote) <= 0) continue
    if (dominantPhase(vote.phase) === leader) count += 1
  }
  return count
}

function phaseConsensus(votes: AxisVote[], readingScope: ReadingScope): AxisConsensus['phase'] {
  const { participating, unreadable } = partition(votes, 'phase')
  const weightFn = (vote: AxisVote) => phaseWeight(vote, readingScope)
  const tally = buildPhaseTally(votes, weightFn)
  const leader = phaseLeader(tally)
  const leaderShare = round1(tally[leader])
  const participantCount = countPhaseParticipants(votes, weightFn)
  const unanimityCount = countPhaseUnanimity(votes, leader, weightFn)
  const coreTally = computeCoreTally(votes, PHASE_CORE_SYSTEMS)

  const readable = votes.filter((vote) => vote.phase !== null)
  const oppositions: PhaseOpposition[] = []
  for (let i = 0; i < readable.length; i += 1) {
    for (let j = i + 1; j < readable.length; j += 1) {
      const left = readable[i]!
      const right = readable[j]!
      const leftPhase = left.phase!
      const rightPhase = right.phase!
      if (leftPhase.advance >= PHASE_CLASH_END && rightPhase.release >= PHASE_CLASH_END) {
        oppositions.push({ a: left.system, b: right.system, gap: round1(Math.min(leftPhase.advance, rightPhase.release)) })
      } else if (leftPhase.release >= PHASE_CLASH_END && rightPhase.advance >= PHASE_CLASH_END) {
        oppositions.push({ a: right.system, b: left.system, gap: round1(Math.min(rightPhase.advance, leftPhase.release)) })
      }
    }
  }

  const polarized =
    tally.advance >= PHASE_POLARIZED_ADVANCE_MIN &&
    tally.release >= PHASE_POLARIZED_RELEASE_MIN &&
    tally.hold < PHASE_POLARIZED_HOLD_MAX

  return {
    tally,
    leader,
    leaderShare,
    unanimityCount,
    participantCount,
    coreTally,
    polarized,
    oppositions,
    participating,
    unreadable,
  }
}

export function computeConsensus(votes: AxisVote[], options: ComputeConsensusOptions = {}): AxisConsensus {
  const readingScope = options.readingScope ?? 'life'
  const traits = traitConsensus(votes)
  const elements = elementConsensus(votes)
  const phase = phaseConsensus(votes, readingScope)

  let participating = 0
  let partial = 0
  let unreadable = 0
  for (const vote of votes) {
    const filled = [vote.traits, vote.elements, vote.phase].filter((space) => space !== null).length
    if (filled === 0) unreadable += 1
    else if (filled < 3) {
      participating += 1
      partial += 1
    } else participating += 1
  }

  return {
    traits,
    elements,
    phase,
    systemCount: {
      total: votes.length,
      participating,
      partial,
      unreadable,
    },
  }
}

/** Test helper — a readable vote with explicit weights. */
export function syntheticVote(
  system: SystemId,
  partial: {
    traits?: TraitVector
    elements?: ElementVector
    phase?: PhaseVector
    traitsWeight?: 1 | 0.5
    elementsWeight?: 1 | 0.5
    phaseWeight?: 1 | 0.5
    phaseTimescale?: PhaseTimescale
    traitsBasis?: 'direct' | 'derived' | 'degraded'
    elementsBasis?: 'direct' | 'derived' | 'degraded'
    phaseBasis?: 'direct' | 'derived' | 'degraded'
  },
): AxisVote {
  const unreadable: AxisVote['unreadable'] = []
  if (!partial.traits) unreadable.push({ space: 'traits', code: `${system}.no_trait_reading` })
  if (!partial.elements) unreadable.push({ space: 'elements', code: `${system}.no_element_reading` })
  if (!partial.phase) unreadable.push({ space: 'phase', code: `${system}.no_phase_reading` })

  const traitsBasis = partial.traitsBasis ?? (partial.traitsWeight === 0.5 ? 'degraded' : 'direct')
  const elementsBasis = partial.elementsBasis ?? (partial.elementsWeight === 0.5 ? 'degraded' : 'direct')
  const phaseBasis = partial.phaseBasis ?? (partial.phaseWeight === 0.5 ? 'degraded' : 'direct')

  return {
    system,
    traits: partial.traits ?? null,
    elements: partial.elements ?? null,
    phase: partial.phase ?? null,
    confidence: {
      traits: partial.traits
        ? { weight: partial.traitsWeight ?? 1, basis: traitsBasis }
        : null,
      elements: partial.elements
        ? { weight: partial.elementsWeight ?? 1, basis: elementsBasis }
        : null,
      phase: partial.phase
        ? {
            weight: partial.phaseWeight ?? 1,
            basis: phaseBasis,
            timescale: partial.phaseTimescale ?? PHASE_TIMESCALE[system],
          }
        : null,
    },
    unreadable,
    reasons: {},
    engineVersion: 'test',
  }
}
