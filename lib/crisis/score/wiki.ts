const PAST_EVENT = [
  /,\s*(?:1[0-9]{3}|20[0-9]{2})\s*$/,
  /\b(?:earthquake|flood|cyclone|hurricane|typhoon|outbreak),\s*(?:1[0-9]{3}|20[0-9]{2})\b/i,
]

function wordChar(ch: string | undefined): boolean {
  if (!ch) return false
  return /[\p{L}\p{N}]/u.test(ch)
}

export function hazardTermIsWholeWord(title: string, term: string): boolean {
  const hay = title.toLowerCase()
  const needle = term.trim().toLowerCase()
  if (!needle) return false
  let from = 0
  while (from < hay.length) {
    const at = hay.indexOf(needle, from)
    if (at < 0) return false
    const before = at === 0 || !wordChar(hay[at - 1])
    const after = at + needle.length >= hay.length || !wordChar(hay[at + needle.length])
    if (before && after) return true
    from = at + 1
  }
  return false
}

export function wikiArticleTitle(stored: string): string {
  return stored.replace(/\s*\([^)]*wikipedia[^)]*\)\s*$/i, '').trim()
}

export type WikiDropReason = 'year' | 'past_event' | 'term' | 'person'

export function classifyWikiTitle(
  title: string,
  term: string,
  nowYear: number,
): { keep: boolean; reason: WikiDropReason | null } {
  const years = [...title.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)].map((match) => Number(match[1]))
  if (years.some((year) => year < nowYear - 1)) return { keep: false, reason: 'year' }
  if (PAST_EVENT.some((pattern) => pattern.test(title))) return { keep: false, reason: 'past_event' }
  const tokens = title.split(/\s+/).filter(Boolean)
  const personalName =
    tokens.length >= 2 &&
    tokens.length <= 3 &&
    tokens.every((token) => /^[\p{Lu}]/u.test(token)) &&
    !tokens.some((token) => hazardTermIsWholeWord(token, term))
  if (personalName) return { keep: false, reason: 'person' }
  if (!hazardTermIsWholeWord(title, term)) return { keep: false, reason: 'term' }
  return { keep: true, reason: null }
}
