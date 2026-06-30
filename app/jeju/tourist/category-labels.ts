/**
 * Friendly display labels for VisitJeju category codes, shared by the
 * server page (curation) and the client search panel (recommendation cards) so
 * the mapping stays in one place. Plain module — no server/client-only imports.
 */
import type { TouristUiPack } from '@/lib/jeju/tourist-labels'

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
