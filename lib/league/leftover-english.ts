/**
 * Discourse words a translator often leaves in an otherwise non-English
 * rationale. Tickers, model names, and acronyms (HBM, DRAM, SMA) are not
 * in this list and stay as written.
 */
const DISCOURSE =
  /\b(?:Recent|However|Despite|Although|Meanwhile|Therefore|Moreover|Furthermore|Additionally|Currently|Previously|Overall|Because|While|According|Notably|Importantly|Finally|Instead|Otherwise|Nevertheless|Nonetheless|Consequently|Generally|Specifically|Within|Without|Between|Against|During)\b/i

export function hasLeftoverDiscourse(text: string): boolean {
  return DISCOURSE.test(text)
}

export function splitRationaleSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…。])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** Sentences that still contain a leftover discourse word. */
export function leftoverDiscourseSentences(text: string): string[] {
  return splitRationaleSentences(text).filter((sentence) => hasLeftoverDiscourse(sentence))
}

/** Splice re-translations back. Indexes are positions in `splitRationaleSentences`. */
export function replaceRationaleSentences(text: string, replacements: ReadonlyMap<number, string>): string {
  const parts = splitRationaleSentences(text)
  if (parts.length === 0) return text
  return parts
    .map((sentence, index) => {
      const next = replacements.get(index)?.trim()
      return next || sentence
    })
    .join(' ')
}
