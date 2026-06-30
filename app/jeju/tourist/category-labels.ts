/**
 * Friendly display labels for VisitJeju category codes, shared by the
 * server page (curation) and the client search panel (recommendation cards) so
 * the mapping stays in one place. Plain module — no server/client-only imports.
 */
import type { TouristLocale, TouristUiPack } from '@/lib/jeju/tourist-labels'

export const DISPLAY_LABEL: Record<string, string> = {
  c1: '가볼 곳',
  c4: '맛집',
  c2: '쇼핑',
  c5: '축제',
  c6: '테마',
}

/** Resolves a place's friendly (Korean) label, falling back to its raw API label. */
export function displayLabelForPlace(place: {
  categoryCode: string
  categoryLabel: string
}): string {
  return DISPLAY_LABEL[place.categoryCode] ?? place.categoryLabel
}

/** Maps a VisitJeju category code to its translatable label key in the pack. */
const CATEGORY_LABEL_KEY: Record<string, keyof TouristUiPack> = {
  c1: 'catSpots',
  c4: 'catFood',
  c2: 'catShopping',
  c5: 'catFestival',
  c6: 'catTheme',
}

/**
 * Locale-aware label for a place. Uses the translated category label when the
 * code is known, otherwise falls back to the raw API label (Korean).
 */
export function localizedDisplayLabel(
  place: { categoryCode: string; categoryLabel: string },
  t: TouristUiPack
): string {
  const key = CATEGORY_LABEL_KEY[place.categoryCode]
  return key ? (t[key] as string) : place.categoryLabel
}

/**
 * Localizes a COURSE STOP category for display.
 *
 * The course engine emits stable Korean category keywords server-side (so we
 * never rely on the AI to translate categories). On the client we map those
 * keywords to the localized pack label. For Korean — and for any category we
 * don't recognize — we return the raw Korean unchanged, so Korean users see
 * zero change and uncommon categories degrade gracefully.
 */
export function localizeCourseCategory(
  category: string | null,
  locale: TouristLocale,
  t: TouristUiPack
): string {
  const raw = category?.trim() ?? ''
  if (!raw || locale === 'ko') return raw

  // Keyword match against the Korean key the server produced. Order matters:
  // more specific buckets first (e.g. 카페 before 맛집-ish food terms).
  if (/오름/.test(raw)) return t.catOreum
  if (/카페|커피|베이커리|디저트/.test(raw)) return t.ccCafe
  if (/맛집|음식|식당|횟집|먹거리/.test(raw)) return t.ccRestaurant
  if (/염전/.test(raw)) return t.ccSaltFarm
  if (/해변|해수욕|바다/.test(raw)) return t.ccBeach
  if (/해안/.test(raw)) return t.ccCoast
  if (/숲|둘레|올레|트레일|트래킹|산책|등산/.test(raw)) return t.ccForest
  if (/박물|미술|전시|문화|유적|갤러리/.test(raw)) return t.ccExhibit
  if (/체험|스포츠|다이빙|서핑|스노클/.test(raw)) return t.ccExperience
  if (/정원|수목원|공원/.test(raw)) return t.ccPark
  if (/시장/.test(raw)) return t.ccMarket
  if (/관광|명소/.test(raw)) return t.ccAttraction

  // Unknown category → keep the raw Korean (graceful, like bus stop names).
  return raw
}
