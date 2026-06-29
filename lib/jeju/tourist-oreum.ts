import 'server-only'

import { getAttractionsByField } from '@/lib/jeju/attraction-utils'
import type { VisitJejuPlace } from '@/lib/jeju/connectors'

/**
 * Jeju TOURIST mode — 오름 (volcanic cone) chip.
 *
 * Source: odcloud official attraction dataset, 분야==='오름' (~119 items, all with coords).
 * Maps JejuAttraction → VisitJejuPlace so existing PlaceCard + detailFromVisitJeju
 * (coordinate-based accurate maps) work unchanged.
 *
 * Returns ~15-18 oreum, rotated daily so the set varies across visits.
 * Never throws.
 */

const DISPLAY_COUNT = 18

/** Simple daily seed (hash of today string → stable per day, varied across days). */
function dailySeed(today: string): number {
  let h = 5381
  for (let i = 0; i < today.length; i++) {
    h = Math.imul(h, 33) ^ today.charCodeAt(i)
  }
  return Math.abs(h)
}

/**
 * Extracts the 시/군 part from a Jeju road address.
 * "제주특별자치도 서귀포시 1100로 1555" → "서귀포"
 */
function extractRegion(address: string): string {
  const m = address.match(/제주(?:특별자치도)?\s+([^\s]+(?:시|군))/)
  return m ? (m[1] ?? '') : ''
}

export async function getOreumList(
  opts?: { today?: string }
): Promise<{ ok: true; oreum: VisitJejuPlace[] } | { ok: false; error: string }> {
  try {
    const today = opts?.today ?? new Date().toISOString().slice(0, 10)
    const seed = dailySeed(today)

    // All 오름 from official attractions (all have valid coords).
    const all = await getAttractionsByField(['오름'], { limit: 200 })
    if (all.length === 0) {
      return { ok: false, error: '오름 정보를 불러오지 못했어요. 다시 시도해 주세요.' }
    }

    // Prefer items with a non-empty introduction (more useful in the modal).
    const withIntro = all.filter((a) => a.intro.trim().length > 0)
    const pool = withIntro.length >= DISPLAY_COUNT ? withIntro : all

    // Daily rotation: offset into the pool so the set changes each day.
    const offset = seed % pool.length
    const rotated = [...pool.slice(offset), ...pool.slice(0, offset)]
    const picks = rotated.slice(0, DISPLAY_COUNT)

    // Map JejuAttraction → VisitJejuPlace (PlaceCard + detailFromVisitJeju compatible).
    const oreum: VisitJejuPlace[] = picks.map((a, i) => ({
      // Use a stable synthetic id (attraction has no contentsId).
      contentsId: `oreum-${a.name.replace(/\s+/g, '-')}-${i}`,
      categoryCode: 'c1',
      categoryLabel: '오름',
      title: a.name,
      region: extractRegion(a.roadAddress),
      address: a.roadAddress || a.jibunAddress,
      introduction: a.intro,
      tags: ['오름', '자연', a.field].filter((v, idx, arr) => arr.indexOf(v) === idx),
      rawTags: '오름 자연',
      lat: a.lat,
      lng: a.lng,
      imageUrl: null,
      thumbnailUrl: null,
      phone: a.phone ?? undefined,
      openingHours: undefined,
    }))

    return { ok: true, oreum }
  } catch {
    return { ok: false, error: '오름 정보를 불러오지 못했어요. 다시 시도해 주세요.' }
  }
}
