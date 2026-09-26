/**
 * Centre policy: one native judgement. Never "12 systems agree".
 *
 * Priority: 억부 용신 when eokbu.yongsin is non-null.
 *   신약 → FILL that element (인성)
 *   신강 → DRAIN that element (식상) — hollow core
 * Fallback when 중화 or 종격 leaves yongsin null: consensus.elements.deficiency
 * argmax. Marked `source: 'consensus'` internally; copy must not claim agreement.
 */

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

export function resolveCentre(input: {
  eokbu: EokbuResult | null | undefined
  deficiency: ElementVector | Partial<Record<FiveElement, number>> | Record<string, unknown> | null | undefined
}): TalismanCentre {
  const yongsin = input.eokbu?.yongsin ?? null
  const strength = input.eokbu?.strength ?? null
  if (yongsin && (strength === 'weak' || strength === 'strong')) {
    return {
      source: 'eokbu',
      mode: strength === 'weak' ? 'fill' : 'drain',
      element: yongsin,
      strength,
    }
  }
  return {
    source: 'consensus',
    mode: 'fill',
    element: pickDeficiencyLeader(input.deficiency),
  }
}
