/**
 * Titles that are past events even when they contain no year.
 * Editable. A Wikidata P580/P585 year more than two years ago is a second drop.
 */
export const WIKI_HISTORICAL_TITLES: readonly string[] = [
  '15 Temmuz Darbe Girişimi',
  'Peste Negra',
  'Black Death',
  'World War I',
  'World War II',
  'First World War',
  'Second World War',
  'Korean War',
  'Vietnam War',
  'Gulf War',
  'Six-Day War',
  'Yom Kippur War',
  'Iran–Iraq War',
  'Iran-Iraq War',
]

function fold(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

const FOLDED = WIKI_HISTORICAL_TITLES.map(fold)

export function isHistoricalWikiTitle(title: string): boolean {
  const hay = fold(title)
  if (!hay) return false
  return FOLDED.some((needle) => hay === needle || hay.includes(needle))
}
