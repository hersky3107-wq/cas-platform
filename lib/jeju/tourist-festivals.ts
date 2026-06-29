import 'server-only'

import { getVisitJejuPool, type VisitJejuPlace } from '@/lib/jeju/connectors'

/**
 * Jeju TOURIST mode — festivals/events from VisitJeju c5 (축제/행사) ONLY.
 *
 * WHY VisitJeju c5 (no sonar): c5 carries ~298 REAL events that already include
 * coordinates, so every item is map-pinnable and nothing is invented. We give up
 * precise "happening this week" filtering for now — the 문화축제표준데이터
 * (structured dates) will be integrated in the API-expansion phase. Until then we
 * apply a light heuristic: exclude items whose latest parseable year is before the
 * current year (or marked "취소"), keep undated items, and gently surface
 * season-relevant ones among the rest.
 *
 * Returns VisitJejuPlace[] so the UI renders them with the SAME PlaceCard + detail
 * modal as other VisitJeju places (accurate coordinate maps). Never throws.
 */

/** How many festivals to return. */
const MAX_FESTIVALS = 15

/** Month (1–12) → seasonal keywords that hint "relevant right now". Light touch. */
const SEASON_KEYWORDS: Record<number, string[]> = {
  1: ['겨울', '눈', '동백', '설'],
  2: ['겨울', '동백', '매화', '설'],
  3: ['봄', '벚꽃', '유채', '매화'],
  4: ['봄', '벚꽃', '유채', '튤립'],
  5: ['봄', '장미', '철쭉', '청보리'],
  6: ['여름', '수국', '루피너스'],
  7: ['여름', '해변', '해수욕', '수국'],
  8: ['여름', '해변', '해수욕', '밤'],
  9: ['가을', '메밀', '억새', '코스모스'],
  10: ['가을', '억새', '단풍', '메밀', '핑크뮬리', '국화'],
  11: ['가을', '단풍', '감귤', '국화'],
  12: ['겨울', '동백', '눈', '귤', '빛'],
}

/** Parses the year/month from a 'YYYY-MM-DD' string (defensive). */
function parseToday(today: string): { year: number; month: number } {
  const m = today.match(/^(\d{4})-(\d{2})/)
  const now = new Date()
  return {
    year: m ? parseInt(m[1]!, 10) : now.getFullYear(),
    month: m ? parseInt(m[2]!, 10) : now.getMonth() + 1,
  }
}

/**
 * Exclude items whose latest parseable year is strictly before the current year,
 * or that contain "취소". Items with no parseable year are kept (we can't tell).
 */
function isExcludedPastOrCancelled(place: VisitJejuPlace, currentYear: number): boolean {
  const hay = `${place.title} ${place.introduction}`
  if (/취소/.test(hay)) return true

  const years = Array.from(hay.matchAll(/\b(20\d{2})\b/g)).map((mm) => parseInt(mm[1]!, 10))
  if (years.length === 0) return false
  const latest = Math.max(...years)
  return latest < currentYear
}

/** Light seasonal relevance: true when title/intro mentions a current-month keyword. */
function isSeasonRelevant(place: VisitJejuPlace, month: number): boolean {
  const keywords = SEASON_KEYWORDS[month] ?? []
  if (keywords.length === 0) return false
  const hay = `${place.title} ${place.introduction}`
  return keywords.some((k) => hay.includes(k))
}

/**
 * Returns Jeju festivals/events from VisitJeju c5, excluding clearly-past/cancelled
 * items and lightly ranking the rest by seasonal relevance. Never throws.
 */
export async function getCurrentFestivals({
  today,
}: {
  today: string
}): Promise<{ ok: true; festivals: VisitJejuPlace[] } | { ok: false; error: string }> {
  try {
    const { year, month } = parseToday(today)

    const pool = await getVisitJejuPool()
    const c5 = pool.filter((p) => p.categoryCode === 'c5')
    if (c5.length === 0) {
      return { ok: false, error: '축제 정보를 불러오지 못했어요. 다시 시도해 주세요.' }
    }

    const eligible = c5.filter((place) => !isExcludedPastOrCancelled(place, year))
    if (eligible.length === 0) {
      return { ok: false, error: '축제 정보를 불러오지 못했어요. 다시 시도해 주세요.' }
    }

    // Rank: season-relevant first, then the rest. Stable within each tier.
    const scored = eligible.map((place, idx) => {
      const seasonal = isSeasonRelevant(place, month)
      const tier = seasonal ? 1 : 0
      return { place, tier, idx }
    })

    scored.sort((a, b) => (b.tier - a.tier) || (a.idx - b.idx))

    const festivals = scored.slice(0, MAX_FESTIVALS).map((s) => s.place)
    return { ok: true, festivals }
  } catch {
    return { ok: false, error: '축제 정보를 불러오지 못했어요. 다시 시도해 주세요.' }
  }
}
