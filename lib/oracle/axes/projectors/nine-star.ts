/**
 * 구성기학 (Nine Star Ki) projector.
 *
 * Traits   — derived, from 본명성 (year star) alone.
 * Elements — direct, blending the 년/월/일盤 stars' native 五行
 *            (year 50% / month 30% / day 20% — year is the broadest,
 *            slowest-moving signal).
 * Phase    — direct, from the five-element relation between 본명성 and
 *            each of 년/월/일盤 (day 50% / month 30% / year 20% — day is
 *            the most immediate 방위 signal). See `FIVE_ELEMENT_RELATION_PHASE`
 *            for why this proxies the classical 방위-grid reading.
 *
 * No unreadable branch: a nine-star reading only needs a civil date.
 */
import { CALENDAR_ENGINE_VERSION, nineStar } from '../../engines/calendar'
import { overcomes, producedBy } from '../../engines/calendar/tables'
import type { FiveElement, NineStarValue } from '../../engines/calendar/types'
import { DIRECT_WEIGHT, HALF_WEIGHT, phaseConfidence } from '../conventions'
import { clampTraits, emptyElements, emptyPhase, emptyTraits, normalizeElements, normalizePhase } from '../math'
import { FIVE_ELEMENT_RELATION_PHASE, NINE_STAR_ELEMENT_WEIGHT, NINE_STAR_PHASE_WEIGHT, NINE_STAR_TRAITS } from '../tables'
import { TRAIT_AXES, type AxisVote, type PhaseVector, type TraitVector } from '../types'

export type NineStarProjectorInput = {
  date: string
  time: string | null
  timezone: string
  atDate: string
}

type Relation = 'same' | 'produces' | 'producedBy' | 'dominates' | 'dominatedBy'

function classify(reference: FiveElement, target: FiveElement): Relation {
  if (target === reference) return 'same'
  if (target === producedBy(reference)) return 'produces'
  if (target === overcomes(reference)) return 'dominates'
  if (reference === overcomes(target)) return 'dominatedBy'
  return 'producedBy'
}

function traitsFromYearStar(yearStar: NineStarValue): TraitVector {
  const mix = NINE_STAR_TRAITS[yearStar.number]!
  const raw = emptyTraits()
  for (const axis of TRAIT_AXES) raw[axis] = mix[axis] * 100
  return clampTraits(raw)
}

function elementsFromStars(stars: { year: NineStarValue; month: NineStarValue; day: NineStarValue }) {
  const raw = emptyElements()
  raw[stars.year.element] += NINE_STAR_ELEMENT_WEIGHT.year * 100
  raw[stars.month.element] += NINE_STAR_ELEMENT_WEIGHT.month * 100
  raw[stars.day.element] += NINE_STAR_ELEMENT_WEIGHT.day * 100
  return normalizeElements(raw)
}

function phaseFromRelations(honmeisei: FiveElement, stars: { year: NineStarValue; month: NineStarValue; day: NineStarValue }): PhaseVector | null {
  const raw = emptyPhase()
  const weighted: [NineStarValue, number][] = [
    [stars.year, NINE_STAR_PHASE_WEIGHT.year],
    [stars.month, NINE_STAR_PHASE_WEIGHT.month],
    [stars.day, NINE_STAR_PHASE_WEIGHT.day],
  ]
  for (const [star, weight] of weighted) {
    const relation = classify(honmeisei, star.element)
    raw[FIVE_ELEMENT_RELATION_PHASE[relation]] += weight * 100
  }
  return normalizePhase(raw)
}

export function projectNineStar(input: NineStarProjectorInput): AxisVote {
  const natal = nineStar({ date: input.date, time: input.time ?? '12:00', timezone: input.timezone })
  const current = nineStar({ date: input.atDate, time: '12:00', timezone: input.timezone })

  const traits = traitsFromYearStar(natal.year)
  // Elements read the person's own natal 년/월/일盤 triad (their innate
  // composition), the same role 사주's fiveElementBalance plays for saju.
  const elements = elementsFromStars(natal)
  // Phase compares 본명성 (natal year star) against the CURRENT 년/월/일盤 —
  // "the relationship between 본명성 and the current position."
  const phase = phaseFromRelations(natal.year.element, current)

  const unreadable: AxisVote['unreadable'] = []
  if (!elements) unreadable.push({ space: 'elements', code: 'ninestar.no_element_reading' })
  if (!phase) unreadable.push({ space: 'phase', code: 'ninestar.no_phase_reading' })

  const reasons: AxisVote['reasons'] = {
    traits: ['ninestar.traits.honmeisei'],
    elements: ['ninestar.elements.year_month_day_blend'],
    phase: ['ninestar.phase.honmeisei_relation'],
  }
  if (input.time === null) reasons.traits = [...(reasons.traits ?? []), 'ninestar.time_unknown_noon_fallback']

  return {
    system: 'ninestar',
    traits,
    elements,
    phase,
    confidence: {
      traits: { weight: HALF_WEIGHT, basis: 'derived' },
      elements: elements ? { weight: DIRECT_WEIGHT, basis: 'direct' } : null,
      phase: phase ? phaseConfidence('ninestar', DIRECT_WEIGHT, 'direct') : null,
    },
    unreadable,
    reasons,
    engineVersion: CALENDAR_ENGINE_VERSION,
  }
}
