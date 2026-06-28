/**
 * Friendly Korean display labels for VisitJeju category codes, shared by the
 * server page (curation) and the client search panel (recommendation cards) so
 * the mapping stays in one place. Plain module — no server/client-only imports.
 */
export const DISPLAY_LABEL: Record<string, string> = {
  c1: '가볼 곳',
  c4: '맛집',
  c2: '쇼핑',
  c5: '축제',
  c6: '테마',
}

/** Resolves a place's friendly label, falling back to its raw API label. */
export function displayLabelForPlace(place: {
  categoryCode: string
  categoryLabel: string
}): string {
  return DISPLAY_LABEL[place.categoryCode] ?? place.categoryLabel
}
