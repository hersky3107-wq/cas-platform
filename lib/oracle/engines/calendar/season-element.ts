/**
 * seasonElement: WOOD/FIRE/EARTH/METAL/WATER, per the traditional "사립전 18일土"
 * (土旺) rule — the ~18 days immediately before each of 입춘/입하/입추/입동 belong
 * to Earth; the remainder of each season carries that season's own element.
 * Boundaries come from real per-year solar terms (`solarTerms()`), not fixed
 * calendar ranges.
 */
import type { DateTimeInput, SeasonElement } from './types'
import { FOUR_LI_SEASON_ELEMENT } from './tables'
import { solarTerms } from './ganzhi'
import { assertYearInRange, parseYmd, resolveInstantUtc } from './utils'

const EIGHTEEN_DAYS_MS = 18 * 86400 * 1000

export function seasonElement(input: DateTimeInput): SeasonElement {
  const { date, time, timezone } = input
  const { y } = parseYmd(date)
  assertYearInRange(y)
  const utcInstant = resolveInstantUtc(date, time, timezone)

  const fourLi = [y - 1, y, y + 1]
    .flatMap((yr) => solarTerms(yr))
    .filter((t) => t.isJie && t.branchIndexIfJie !== null && t.branchIndexIfJie in FOUR_LI_SEASON_ELEMENT)
    .sort((a, b) => a.utcIso.localeCompare(b.utcIso))

  const instantMs = utcInstant.getTime()
  let currentIdx = -1
  for (let i = 0; i < fourLi.length; i++) {
    if (new Date(fourLi[i]!.utcIso).getTime() <= instantMs) currentIdx = i
  }
  if (currentIdx === -1 || currentIdx + 1 >= fourLi.length) {
    throw new Error('calendar engine: seasonElement could not bracket the given date within the fetched solar-term window')
  }

  const current = fourLi[currentIdx]!
  const next = fourLi[currentIdx + 1]!
  const nextMs = new Date(next.utcIso).getTime()

  if (instantMs >= nextMs - EIGHTEEN_DAYS_MS) return 'EARTH'
  return FOUR_LI_SEASON_ELEMENT[current.branchIndexIfJie!]!
}
