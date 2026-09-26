/**
 * Centre policy: one native judgement. Never "12 systems agree".
 *
 * Priority: eokbu.talismanLean when 사주 pillars exist.
 *   신약 → FILL, intensity full
 *   신강 → DRAIN, intensity full
 *   중화 → 득령 tie-break, intensity soft (억부 경향)
 *   종격 → FOLLOW the dominant element, intensity full
 * Consensus fallback only when there is no 사주 / no lean at all.
 */

import { talismanLeanFrom } from '../engines/calendar'
import { ELEMENT_AXES, type ElementVector } from '../axes/types'
import type { EokbuResult, FiveElement } from '../engines/calendar'
import type { TalismanCentre } from './types'

export function pickDeficiencyLeader(
  deficiency: Partial<Record<FiveElement, number>> | Record<string, unknown> | null | undefined,
): FiveElement | null {
  if (!deficiency) return null
  let leader: FiveElement | null = null
  let best = 0
  for (const axis of ELEMENT_AXES) {
    const raw = deficiency[axis]
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
    if (value > best) {
      best = value
      leader = axis
    }
  }
  return best > 0 ? leader : null
}

export function centrePathLabel(centre: TalismanCentre): string {
  if (centre.source === 'eokbu') return '억부'
  if (centre.source === 'eokbu-lean') return '억부 경향'
  if (centre.source === 'jonggyeok') return '종격 follow'
  return 'fallback'
}

export function resolveCentre(input: {
  eokbu: EokbuResult | null | undefined
  deficiency: ElementVector | Partial<Record<FiveElement, number>> | Record<string, unknown> | null | undefined
  dayElement?: FiveElement | null
}): TalismanCentre {
  const lean = input.eokbu
    ? (input.eokbu.talismanLean ?? talismanLeanFrom(input.eokbu, input.dayElement ?? null))
    : null
  if (lean) {
    if (lean.mode === 'follow') {
      return { source: 'jonggyeok', mode: 'follow', element: lean.element, intensity: 'full' }
    }
    if (lean.intensity === 'soft') {
      return {
        source: 'eokbu-lean',
        mode: lean.mode,
        element: lean.element,
        strength: 'balanced',
        intensity: 'soft',
      }
    }
    return {
      source: 'eokbu',
      mode: lean.mode,
      element: lean.element,
      strength: lean.mode === 'drain' ? 'strong' : 'weak',
      intensity: 'full',
    }
  }
  return {
    source: 'consensus',
    mode: 'fill',
    element: pickDeficiencyLeader(input.deficiency),
    intensity: 'full',
  }
}
