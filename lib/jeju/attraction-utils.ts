import 'server-only'

import { getJejuAttractions, type JejuAttraction } from '@/lib/jeju/connectors'

/**
 * Shared helpers for Jeju official tourist attraction data (odcloud 15111742).
 * 1046 attractions with valid lat/lng, 관광지 분야 taxonomy.
 * Used by tourist-course.ts (and future chips) to ground AI on real coord data.
 * 'server-only' — no client imports.
 */

// ── 관광지 분야 category groups ───────────────────────────────────────────────

export const NATURE_FIELDS = ['자연', '오름', '트레일', '지질트레일', '생태공원'] as const
export const CULTURE_FIELDS = ['문화', '문화유적', '예술', '유적', '박물관', '사찰'] as const
export const FESTIVAL_FIELDS = ['축제', '축제/행사'] as const
export const MARKET_FIELDS = ['시장'] as const

export type NatureField = (typeof NATURE_FIELDS)[number]
export type CultureField = (typeof CULTURE_FIELDS)[number]

/**
 * Filters the cached official attraction pool by 관광지 분야, with optional
 * region substring match (on 소재지도로명주소) and result cap.
 *
 * All returned items are guaranteed to have valid numeric lat/lng (filtered at
 * fetch time in connectors.ts). Never throws — returns [] on failure.
 *
 * @param fields  분야 values to include (e.g. ['자연','오름'])
 * @param opts.region  substring to match in roadAddress (e.g. '서귀포')
 * @param opts.limit   max items returned (default 30)
 */
export async function getAttractionsByField(
  fields: string[],
  opts?: { region?: string; limit?: number }
): Promise<JejuAttraction[]> {
  try {
    const all = await getJejuAttractions()
    const fieldSet = new Set(fields)

    let filtered = all.filter((a) => fieldSet.has(a.field))

    if (opts?.region) {
      const needle = opts.region.trim().toLowerCase()
      filtered = filtered.filter(
        (a) =>
          a.roadAddress.toLowerCase().includes(needle) ||
          a.jibunAddress.toLowerCase().includes(needle)
      )
    }

    const limit = typeof opts?.limit === 'number' && opts.limit > 0 ? opts.limit : 30
    return filtered.slice(0, limit)
  } catch {
    return []
  }
}
