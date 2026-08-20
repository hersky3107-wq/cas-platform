/**
 * 宿曜経 (27 mansions) projector.
 *
 * Traits   — derived, from the natal mansion's paired 七曜 (seven
 *            luminary) temperament — reusing `ASTRO_BODY_TRAITS` rather
 *            than inventing a second Sun/Moon/Mars/… personality scale.
 * Elements — derived when the mansion's 七曜 is one of the five
 *            element-planets (火水木金土); unreadable when it is 日 or 月,
 *            which sit outside the 五行 system (never forced).
 * Phase    — direct, from `sukuyouRelation(본명宿, 오늘宿)`'s 三九 relation.
 *
 * Birth time does not affect the mansion (civil-date-only), so there is
 * no unreadable branch for unknown birth time.
 */
import { CALENDAR_ENGINE_VERSION, sukuyou, sukuyouRelation } from '../../engines/calendar'
import { DIRECT_WEIGHT, HALF_WEIGHT } from '../conventions'
import { clampTraits, emptyElements, emptyPhase, emptyTraits, normalizeElements, normalizePhase } from '../math'
import { ASTRO_BODY_TRAITS, SUKUYOU_LUMINARY_ELEMENT, SUKUYOU_MANSION_LUMINARY, SUKUYOU_RELATION_PHASE } from '../tables'
import { TRAIT_AXES, type AxisVote } from '../types'

export type SukuyouProjectorInput = {
  birthDate: string
  birthTime: string | null
  /** Structurally required by the calendar engine's `DateTimeInput`; unused for mansion placement. */
  tz: string
  atDate: string
}

export function projectSukuyou(input: SukuyouProjectorInput): AxisVote {
  const natal = sukuyou({ date: input.birthDate, time: input.birthTime, timezone: input.tz })
  const current = sukuyou({ date: input.atDate, time: '12:00', timezone: input.tz })
  const luminary = SUKUYOU_MANSION_LUMINARY[natal.hanja]!

  const traitMix = ASTRO_BODY_TRAITS[luminary]!
  const rawTraits = emptyTraits()
  for (const axis of TRAIT_AXES) rawTraits[axis] = traitMix[axis] * 100
  const traits = clampTraits(rawTraits)

  const elementAxis = SUKUYOU_LUMINARY_ELEMENT[luminary]
  const elements = elementAxis
    ? normalizeElements((() => {
        const raw = emptyElements(8)
        raw[elementAxis] += 68
        return raw
      })())
    : null

  const relation = sukuyouRelation(natal.index, current.index)
  const rawPhase = emptyPhase()
  rawPhase[SUKUYOU_RELATION_PHASE[relation.name]] = 100
  const phase = normalizePhase(rawPhase)

  const unreadable: AxisVote['unreadable'] = []
  if (!elements) unreadable.push({ space: 'elements', code: 'sukuyou.no_wuxing_for_luminary' })

  return {
    system: 'sukuyou',
    traits,
    elements,
    phase,
    confidence: {
      traits: { weight: HALF_WEIGHT, basis: 'derived' },
      elements: elements ? { weight: HALF_WEIGHT, basis: 'derived' } : null,
      phase: phase ? { weight: DIRECT_WEIGHT, basis: 'direct' } : null,
    },
    unreadable,
    reasons: {
      traits: [`sukuyou.traits.luminary_${luminary.toLowerCase()}`],
      elements: elements ? ['sukuyou.elements.luminary_wuxing'] : undefined,
      phase: [`sukuyou.phase.sanku_${relation.name}`],
    },
    engineVersion: CALENDAR_ENGINE_VERSION,
  }
}
