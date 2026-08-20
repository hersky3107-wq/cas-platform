/**
 * PRISM-5 projector.
 *
 * Traits   — direct, 1:1 from coreMatrix.
 * Elements — direct from birth-season 오행 + current element relation.
 * Phase    — direct from the 12-cycle (annual 70% + monthly 30%).
 */
import { seasonElement } from '../../engines/calendar'
import type { SeasonElement } from '../../engines/calendar/types'
import { prism, PRISM_ENGINE_VERSION, PRISM_TIMEZONE } from '../../engines/prism'
import type { CycleId } from '../../engines/prism/tables'
import type { PrismInput, PrismResult } from '../../engines/prism/types'
import { DIRECT_WEIGHT } from '../conventions'
import { clampTraits, emptyElements, normalizeElements, normalizePhase } from '../math'
import { PRISM_CYCLE_PHASE, PRISM_CYCLE_REASON, PRISM_RELATION_REASON } from '../tables'
import type { AxisVote, ElementAxis } from '../types'

const DIRECT = { weight: DIRECT_WEIGHT, basis: 'direct' as const }

function seasonToElement(season: SeasonElement): ElementAxis {
  return season.toLowerCase() as ElementAxis
}

function elementsFromPrism(result: PrismResult, currentSeason: SeasonElement) {
  const birth = seasonToElement(result.birthAnchor.seasonElement)
  const current = seasonToElement(currentSeason)

  const raw = emptyElements(8)
  raw[birth] += 36
  raw[current] += 16

  switch (result.elementRelation) {
    case 'RESONANCE':
      raw[birth] += 16
      break
    case 'SUPPORT':
      raw[current] += 12
      raw[birth] += 8
      break
    case 'OUTPUT':
      raw[current] += 12
      raw[birth] += 4
      break
    case 'CHALLENGE':
      raw[birth] += 8
      break
    case 'PRESSURE':
      raw[current] += 12
      break
  }

  return normalizeElements(raw)
}

function phaseFromCycles(annual: CycleId, monthly: CycleId) {
  const raw = { advance: 0, hold: 0, release: 0 }
  raw[PRISM_CYCLE_PHASE[annual]] += 70
  raw[PRISM_CYCLE_PHASE[monthly]] += 30
  return normalizePhase(raw)
}

export function projectPrismResult(result: PrismResult, atDate: string): AxisVote {
  const currentSeason = seasonElement({ date: atDate, time: '12:00', timezone: PRISM_TIMEZONE })
  const traits = clampTraits(result.coreMatrix)
  const elements = elementsFromPrism(result, currentSeason)
  const phase = phaseFromCycles(result.annualCycle.id, result.monthlyCycle.id)

  const unreadable: AxisVote['unreadable'] = []
  if (!elements) unreadable.push({ space: 'elements', code: 'prism.no_element_reading' })
  if (!phase) unreadable.push({ space: 'phase', code: 'prism.no_phase_reading' })

  return {
    system: 'prism',
    traits,
    elements,
    phase,
    confidence: {
      traits: DIRECT,
      elements: elements ? DIRECT : null,
      phase: phase ? DIRECT : null,
    },
    unreadable,
    reasons: {
      traits: ['prism.traits.core_matrix'],
      elements: [PRISM_RELATION_REASON[result.elementRelation] ?? 'prism.element.resonance'],
      phase: [PRISM_CYCLE_REASON[result.annualCycle.id]],
    },
    engineVersion: PRISM_ENGINE_VERSION,
  }
}

export function projectPrism(input: PrismInput): AxisVote {
  return projectPrismResult(prism(input), input.atDate)
}
