/**
 * Western-astrology projector.
 *
 * Traits  — direct (planets × house × aspect count). Degraded without houses.
 * Elements — derived. The 4 classical elements do not sit on 5 오행; see
 *            CLASSICAL_TO_OHENG. Never claimed as direct.
 * Phase   — direct from applying transit-to-natal aspects.
 */
import { ASTRO_ENGINE_VERSION, natalChart, transits } from '../../engines/astro'
import { CLASSICAL_BODY_NAMES } from '../../engines/astro/tables'
import type { NatalChart, TransitResult } from '../../engines/astro/types'
import { DIRECT_WEIGHT, HALF_WEIGHT, phaseConfidence } from '../conventions'
import { clampTraits, emptyElements, emptyTraits, normalizeElements, normalizePhase } from '../math'
import { ASTRO_BODY_TRAITS, ASTRO_HOUSE_WEIGHT, CLASSICAL_TO_OHENG } from '../tables'
import { TRAIT_AXES, type AxisVote, type SpaceConfidence, type TraitVector } from '../types'

export type AstroProjectorInput = {
  date: string
  time: string | null
  tz: string
  lat: number
  lng: number
  timeKnown: boolean
  asOf: { date: string; time: string; tz: string }
}

function houseWeight(house: number | null, timeKnown: boolean): number {
  if (!timeKnown || house === null) return 1
  return ASTRO_HOUSE_WEIGHT[house] ?? 1
}

function aspectCount(chart: NatalChart, name: string): number {
  return chart.aspects.filter((aspect) => aspect.a === name || aspect.b === name).length
}

function traitsFromNatal(chart: NatalChart): TraitVector {
  const raw = emptyTraits()
  let totalWeight = 0
  for (const name of CLASSICAL_BODY_NAMES) {
    const mix = ASTRO_BODY_TRAITS[name]
    if (!mix) continue
    const body = chart.bodies[name]
    const weight = houseWeight(body.house, chart.timeKnown) * (1 + 0.12 * Math.min(aspectCount(chart, name), 5))
    totalWeight += weight
    for (const axis of TRAIT_AXES) raw[axis] += mix[axis] * weight * 100
  }
  if (totalWeight <= 0) return clampTraits(raw)
  for (const axis of TRAIT_AXES) raw[axis] = raw[axis] / totalWeight
  return clampTraits(raw)
}

function elementsFromNatal(chart: NatalChart) {
  const raw = emptyElements()
  for (const [classical, count] of Object.entries(chart.elementBalance) as [
    'fire' | 'earth' | 'air' | 'water',
    number,
  ][]) {
    const mapped = CLASSICAL_TO_OHENG[classical]
    for (const [oheng, share] of Object.entries(mapped)) {
      raw[oheng as keyof typeof raw] += count * (share ?? 0)
    }
  }
  return normalizeElements(raw)
}

function phaseFromTransits(result: TransitResult | null) {
  if (!result || result.aspects.length === 0) return null
  const raw = { advance: 0, hold: 0, release: 0 }

  for (const aspect of result.aspects) {
    const closeness = Math.max(0.15, 1 - aspect.orb / 8)
    if (!aspect.applying) {
      raw.hold += closeness
      continue
    }
    const hard = aspect.type === 'square' || aspect.type === 'opposition'
    if (hard) {
      raw.release += closeness
      continue
    }
    if (aspect.b === 'Saturn') {
      raw.hold += closeness
      continue
    }
    if (aspect.b === 'Sun' || aspect.b === 'Mars' || aspect.b === 'Jupiter') {
      raw.advance += closeness
      continue
    }
    raw.hold += closeness * 0.6
    raw.advance += closeness * 0.4
  }

  return normalizePhase(raw)
}

function traitsConf(timeKnown: boolean): SpaceConfidence {
  return timeKnown
    ? { weight: DIRECT_WEIGHT, basis: 'direct' }
    : { weight: HALF_WEIGHT, basis: 'degraded' }
}

export function projectAstro(input: AstroProjectorInput): AxisVote {
  const natal = natalChart({
    date: input.date,
    time: input.time,
    tz: input.tz,
    lat: input.lat,
    lng: input.lng,
    timeKnown: input.timeKnown,
  })
  const transitResult: TransitResult = transits({
    natal,
    at: { date: input.asOf.date, time: input.asOf.time, tz: input.asOf.tz },
  })

  const traits = traitsFromNatal(natal)
  const elements = elementsFromNatal(natal)
  const phase = phaseFromTransits(transitResult)
  const timeKnown = natal.timeKnown

  const unreadable: AxisVote['unreadable'] = []
  if (!elements) unreadable.push({ space: 'elements', code: 'astro.no_element_reading' })
  if (!phase) unreadable.push({ space: 'phase', code: 'astro.no_transits' })

  const reasons: AxisVote['reasons'] = {
    traits: timeKnown ? ['astro.traits.houses_and_aspects'] : ['astro.traits.no_houses', 'astro.hour_unknown'],
    elements: ['astro.elements.classical_to_oheng'],
    phase: ['astro.phase.applying_transits'],
  }
  if (!timeKnown) {
    reasons.elements = [...(reasons.elements ?? []), 'astro.moon_approximate']
  }

  return {
    system: 'astro',
    traits,
    elements,
    phase,
    confidence: {
      traits: traitsConf(timeKnown),
      elements: elements ? { weight: HALF_WEIGHT, basis: 'derived' } : null,
      phase: phase ? phaseConfidence('astro', DIRECT_WEIGHT, 'direct') : null,
    },
    unreadable,
    reasons,
    engineVersion: ASTRO_ENGINE_VERSION,
  }
}
