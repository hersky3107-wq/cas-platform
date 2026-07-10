import {
  fetchVisitJejuPool,
  toVisitJejuLocale,
  type VisitJejuPlace,
} from '@/lib/jeju/connectors'
import { STATIC_SHOPPING, VISITJEJU_LANDMARK_IDS, type ShoppingLandmark } from '@/lib/jeju/shopping-static'
import { normalizeAiLocale } from '@/lib/jeju/ai-locale'
import type { TouristLocale } from '@/lib/jeju/tourist-labels'

export const runtime = 'nodejs'
export const maxDuration = 30

// ─────────────────────────────────────────────────────────────────────────────
// JEJU SHOPPING — unified list = STATIC landmarks + live VisitJeju c2 (쇼핑).
// Data merge only, no UI. See lib/jeju/shopping-static.ts for the static set
// and the referenced-by-contentsid landmark markets.
// ─────────────────────────────────────────────────────────────────────────────

/** VisitJeju c2 has ~262 items; 3 pages of 100 covers the whole category. */
const SHOPPING_PAGES = 3

export type ShoppingItemCategory = 'dutyfree' | 'market' | 'mall' | 'shop'

/** ONE normalized output shape so the UI can render static + VisitJeju uniformly. */
export interface ShoppingItem {
  id: string
  name: string
  address: string | null
  phone: string | null
  homepage: string | null
  lat: number | null
  lng: number | null
  category: ShoppingItemCategory
  sponsor: boolean
  note: string | null
  source: 'static' | 'visitjeju'
}

/** Strips spaces + half/full-width parens for loose name-matching (dedup only). */
function normalizeForDedup(s: string): string {
  return s.replace(/[()（）\s]/g, '').toLowerCase()
}

/** Static landmark's own name field stays as-is (nameKo/nameEn); no new UI strings. */
function mapStaticItem(item: ShoppingLandmark, locale: TouristLocale): ShoppingItem {
  return {
    id: item.id,
    name: locale === 'ko' ? item.nameKo : item.nameEn,
    address: item.address,
    phone: item.phone,
    homepage: item.homepage,
    lat: item.lat,
    lng: item.lng,
    category: item.category,
    sponsor: item.sponsor,
    note: item.note,
    source: 'static',
  }
}

/** VisitJeju has no homepage field; landmark ids are typed 'market', others 'shop'. */
function mapVisitJejuItem(place: VisitJejuPlace, isLandmark: boolean): ShoppingItem {
  return {
    id: place.contentsId,
    name: place.title,
    address: place.address || null,
    phone: place.phone ?? null,
    homepage: null,
    lat: place.lat,
    lng: place.lng,
    category: isLandmark ? 'market' : 'shop',
    sponsor: false,
    note: null,
    source: 'visitjeju',
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const locale = normalizeAiLocale(url.searchParams.get('locale'))
  const visitLocale = toVisitJejuLocale(locale)
  const warnings: string[] = []

  // fetchVisitJejuPool never throws (returns [] on total failure) — one bad
  // upstream call degrades gracefully to static-only rather than 500ing.
  let pool: VisitJejuPlace[] = []
  try {
    pool = await fetchVisitJejuPool({
      categories: ['c2'],
      pagesPerCategory: SHOPPING_PAGES,
      locale: visitLocale,
    })
  } catch (e: unknown) {
    warnings.push(`VisitJeju c2 fetch threw: ${e instanceof Error ? e.message : 'unknown error'}`)
  }
  if (pool.length === 0) {
    warnings.push('VisitJeju c2 pool returned no items — showing static landmarks only.')
  }

  // Split the c2 pool into landmark matches (inherit multilingual name/address/
  // coords for free) vs. the general long tail.
  const landmarkIdSet = new Set(VISITJEJU_LANDMARK_IDS)
  const landmarkPlaces: VisitJejuPlace[] = []
  const generalPlaces: VisitJejuPlace[] = []
  for (const place of pool) {
    if (landmarkIdSet.has(place.contentsId)) landmarkPlaces.push(place)
    else generalPlaces.push(place)
  }

  for (const id of VISITJEJU_LANDMARK_IDS) {
    if (!landmarkPlaces.some((p) => p.contentsId === id)) {
      const msg = `Landmark contentsid not found in c2 pool (skipped): ${id}`
      console.warn(`[api/tourist/shopping] ${msg}`)
      warnings.push(msg)
    }
  }

  // Drop general items whose name closely matches a STATIC item (e.g. a duty-free
  // that also has a loose c2 entry) so it doesn't double-appear.
  const staticNameKeys = new Set<string>()
  for (const s of STATIC_SHOPPING) {
    staticNameKeys.add(normalizeForDedup(s.nameKo))
    staticNameKeys.add(normalizeForDedup(s.nameEn))
  }
  const dedupedGeneral = generalPlaces.filter(
    (p) => !staticNameKeys.has(normalizeForDedup(p.title))
  )

  // Assembly order already yields the required sort: sponsor-first (JDC is
  // sortPriority 0), then static sortPriority, then static-before-visitjeju,
  // then the general long tail (alphabetized for determinism).
  const staticItems = STATIC_SHOPPING.map((s) => mapStaticItem(s, locale))
  const landmarkItems = VISITJEJU_LANDMARK_IDS.map((id) =>
    landmarkPlaces.find((p) => p.contentsId === id)
  )
    .filter((p): p is VisitJejuPlace => Boolean(p))
    .map((p) => mapVisitJejuItem(p, true))
  const generalItems = dedupedGeneral
    .map((p) => mapVisitJejuItem(p, false))
    .sort((a, b) => a.name.localeCompare(b.name))

  const items: ShoppingItem[] = [...staticItems, ...landmarkItems, ...generalItems]

  return Response.json({
    items,
    counts: {
      static: staticItems.length,
      landmarks: landmarkItems.length,
      general: generalItems.length,
      total: items.length,
    },
    locale,
    ...(warnings.length > 0 ? { warnings } : {}),
  })
}
