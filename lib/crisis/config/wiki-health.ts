/** Disease concepts that may raise a country-level health_attention flag. Editable. */
export const WIKI_HEALTH_CONCEPTS: readonly string[] = [
  'plague',
  'pneumonic plague',
  'bubonic plague',
  'cholera',
  'ebola',
  'measles',
  'anthrax',
  'mpox',
  'monkeypox',
  'marburg',
  'dengue',
  'malaria',
  'yellow fever',
  'чума',
  'veba',
  'peste',
  'choléra',
  'ébola',
  'rougeole',
  'charbon',
]

function fold(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function isHealthWikiConcept(title: string, term: string): boolean {
  const hay = fold(`${title} ${term}`)
  if (!hay) return false
  return WIKI_HEALTH_CONCEPTS.some((concept) => {
    const needle = fold(concept)
    if (!needle) return false
    let from = 0
    while (from < hay.length) {
      const at = hay.indexOf(needle, from)
      if (at < 0) return false
      const before = at === 0 || !/[\p{L}\p{N}]/u.test(hay[at - 1] ?? '')
      const after = at + needle.length >= hay.length || !/[\p{L}\p{N}]/u.test(hay[at + needle.length] ?? '')
      if (before && after) return true
      from = at + 1
    }
    return false
  })
}
