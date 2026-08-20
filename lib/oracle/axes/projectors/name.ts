/**
 * 성명판단 (name divination) projector.
 *
 * Traits   — derived, from the five 격's own elemental nature (see
 *            `NAME_ELEMENT_TRAITS`), weighted with 人格 heaviest.
 * Elements — direct, the 수리 오행 (last-digit → 五行) across all five
 *            격 — three (天/人/地) already computed by the engine, the
 *            other two (外/總) via the SAME exported `elementForGyeok`
 *            the engine itself uses internally, not a second formula.
 * Phase    — UNREADABLE. A name is fixed for life; there is no time
 *            axis to derive a phase from.
 *
 * Non-CJK locales: the engine returns `supported: false` (its own
 * `no Latin-alphabet stroke system` rule). All three spaces are
 * unreadable with code 'name.locale_unsupported'.
 */
import { elementForGyeok, NAME_ENGINE_VERSION, nameReading } from '../../engines/name'
import type { Gyeok, NameInput } from '../../engines/name'
import { DIRECT_WEIGHT, HALF_WEIGHT } from '../conventions'
import { clampTraits, emptyElements, emptyTraits, normalizeElements } from '../math'
import { NAME_ELEMENT_TRAITS, NAME_GYEOK_WEIGHT } from '../tables'
import { TRAIT_AXES, type AxisVote, type ElementAxis, type TraitVector } from '../types'

export type NameProjectorInput = NameInput

const GYEOK_KEYS = ['cheon', 'in', 'ji', 'oe', 'chong'] as const
type GyeokKey = (typeof GYEOK_KEYS)[number]
type ElementByGyeok = Record<GyeokKey, ElementAxis>

function traitsFromGyeok(elementByGyeok: ElementByGyeok): TraitVector {
  const raw = emptyTraits()
  for (const key of GYEOK_KEYS) {
    const mix = NAME_ELEMENT_TRAITS[elementByGyeok[key]]
    const weight = NAME_GYEOK_WEIGHT[key]
    for (const axis of TRAIT_AXES) raw[axis] += mix[axis] * weight * 100
  }
  return clampTraits(raw)
}

function elementsFromGyeok(elementByGyeok: ElementByGyeok) {
  const raw = emptyElements()
  for (const key of GYEOK_KEYS) {
    raw[elementByGyeok[key]] += NAME_GYEOK_WEIGHT[key]
  }
  return normalizeElements(raw)
}

function unsupportedVote(): AxisVote {
  return {
    system: 'name',
    traits: null,
    elements: null,
    phase: null,
    confidence: { traits: null, elements: null, phase: null },
    unreadable: [
      { space: 'traits', code: 'name.locale_unsupported' },
      { space: 'elements', code: 'name.locale_unsupported' },
      { space: 'phase', code: 'name.locale_unsupported' },
    ],
    reasons: {},
    engineVersion: NAME_ENGINE_VERSION,
  }
}

export function projectName(input: NameProjectorInput): AxisVote {
  const result = nameReading(input)
  if (!result.supported) return unsupportedVote()

  const gyeok: Gyeok = result.gyeok
  const elementByGyeok: ElementByGyeok = {
    cheon: result.fiveElements.cheon,
    in: result.fiveElements.in,
    ji: result.fiveElements.ji,
    oe: elementForGyeok(gyeok.oe),
    chong: elementForGyeok(gyeok.chong),
  }

  const traits = traitsFromGyeok(elementByGyeok)
  const elements = elementsFromGyeok(elementByGyeok)

  const unreadable: AxisVote['unreadable'] = [{ space: 'phase', code: 'name.no_time_axis' }]
  if (!elements) unreadable.push({ space: 'elements', code: 'name.no_element_reading' })

  return {
    system: 'name',
    traits,
    elements,
    phase: null,
    confidence: {
      traits: { weight: HALF_WEIGHT, basis: 'derived' },
      elements: elements ? { weight: DIRECT_WEIGHT, basis: 'direct' } : null,
      phase: null,
    },
    unreadable,
    reasons: {
      traits: ['name.traits.gyeok_element_archetype'],
      elements: elements ? ['name.elements.suri_oheng_five_gyeok'] : undefined,
    },
    engineVersion: NAME_ENGINE_VERSION,
  }
}
