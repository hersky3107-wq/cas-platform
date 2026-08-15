/** 오행 강약 (five-element balance): counts each of the 8 (or 6, if hour unknown) chars' elements. */
import type { FiveElementCounts, FourPillars } from './types'

export function fiveElementBalance(pillars: FourPillars): FiveElementCounts {
  const counts: FiveElementCounts = { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 }
  const chars = [
    pillars.year.stem,
    pillars.year.branch,
    pillars.month.stem,
    pillars.month.branch,
    pillars.day.stem,
    pillars.day.branch,
    ...(pillars.hour ? [pillars.hour.stem, pillars.hour.branch] : []),
  ]
  for (const c of chars) counts[c.element]++
  return counts
}
