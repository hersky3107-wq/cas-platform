/**
 * Pythagorean numerology projector.
 *
 * Traits   — derived, blending life-path (60%) and expression (40%)
 *            numbers — life path as the whole-life core, expression as
 *            how it plays out day to day. Falls back to life path alone
 *            when there is no Latin name to derive an expression number.
 * Elements — UNREADABLE. Pythagorean numerology has no element system
 *            that maps onto 五行 (성명판단's 수리 오행 is a genuinely
 *            different, real mapping — see `name.ts` — not reused here).
 * Phase    — direct, from the personal year number's explicit 1-9 cycle
 *            of beginning / building / completing.
 */
import { numerology, NUMEROLOGY_ENGINE_VERSION } from '../../engines/numerology'
import type { NumerologyResult } from '../../engines/numerology'
import { DIRECT_WEIGHT, HALF_WEIGHT, phaseConfidence } from '../conventions'
import { clampTraits, emptyTraits, softenPhase } from '../math'
import { NUMEROLOGY_MASTER_BASE_DIGIT, NUMEROLOGY_NUMBER_TRAITS, NUMEROLOGY_PERSONAL_YEAR_PHASE } from '../tables'
import { TRAIT_AXES, type AxisVote, type TraitVector } from '../types'

export type NumerologyProjectorInput = {
  /** YYYY-MM-DD */
  birthDate: string
  latinName?: string | null
  /** YYYY-MM-DD */
  atDate: string
}

function traitsFromNumbers(result: NumerologyResult): TraitVector {
  const lifePathMix = NUMEROLOGY_NUMBER_TRAITS[result.lifePath]
  if (!lifePathMix) throw new Error(`axes/numerology: no trait mix for life path ${result.lifePath}`)
  const expressionMix = result.expression !== null ? NUMEROLOGY_NUMBER_TRAITS[result.expression] : null

  const raw = emptyTraits()
  if (expressionMix) {
    for (const axis of TRAIT_AXES) raw[axis] = (lifePathMix[axis] * 0.6 + expressionMix[axis] * 0.4) * 100
  } else {
    for (const axis of TRAIT_AXES) raw[axis] = lifePathMix[axis] * 100
  }
  return clampTraits(raw)
}

function phaseFromPersonalYear(personalYear: number) {
  const baseDigit = NUMEROLOGY_MASTER_BASE_DIGIT[personalYear] ?? personalYear
  const axis = NUMEROLOGY_PERSONAL_YEAR_PHASE[baseDigit]
  if (!axis) throw new Error(`axes/numerology: no phase for personal year ${personalYear}`)
  return softenPhase(axis, 'strong')
}

export function projectNumerology(input: NumerologyProjectorInput): AxisVote {
  const result = numerology({ birthDate: input.birthDate, latinName: input.latinName, atDate: input.atDate })

  const traits = traitsFromNumbers(result)
  const phase = phaseFromPersonalYear(result.personalYear)
  const hasLatinName = result.expression !== null

  return {
    system: 'numerology',
    traits,
    elements: null,
    phase,
    confidence: {
      traits: { weight: HALF_WEIGHT, basis: 'derived' },
      elements: null,
      phase: phase ? phaseConfidence('numerology', DIRECT_WEIGHT, 'direct') : null,
    },
    unreadable: [{ space: 'elements', code: 'numerology.no_wuxing_mapping' }],
    reasons: {
      traits: hasLatinName
        ? ['numerology.traits.lifepath_expression_blend']
        : ['numerology.traits.lifepath_only', 'numerology.no_latin_name'],
      phase: [`numerology.phase.personal_year_${result.personalYear}`],
    },
    engineVersion: NUMEROLOGY_ENGINE_VERSION,
  }
}
