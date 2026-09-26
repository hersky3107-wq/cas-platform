/**
 * Natal 오행 absence for the 부적 — pillar characters only.
 * Never reads axes.elements or the consensus deficiency vector.
 */
import { fiveElementBalance } from '../engines/calendar'
import type { FiveElement, FourPillars } from '../engines/calendar'

/** 木火土金水 — tie-break when several natal elements are missing. */
export const SAJU_ABSENT_ORDER: readonly FiveElement[] = ['wood', 'fire', 'earth', 'metal', 'water']

export type TalismanSecondary = { element: FiveElement; source: 'saju-absent' }

export function absentFromPillars(pillars: FourPillars | null | undefined): FiveElement[] {
  if (!pillars) return []
  const counts = fiveElementBalance(pillars)
  return SAJU_ABSENT_ORDER.filter((element) => counts[element] === 0)
}

export function resolveSecondary(input: {
  pillars: FourPillars | null | undefined
  centreElement: FiveElement | null
}): TalismanSecondary | null {
  const pick = absentFromPillars(input.pillars).find((element) => element !== input.centreElement)
  return pick ? { element: pick, source: 'saju-absent' } : null
}
