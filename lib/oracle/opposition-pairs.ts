export type OppositionPair = { a: string; b: string; gap?: number }

/**
 * Engine phase.oppositions is every advance×release pair above the clash
 * threshold, so one loud system (룬) leads every line with the same quote.
 * Keep each system — and each already-shown one-line — at most once, highest
 * gap first. Two distinct pairs is the most a reader can take in; one is
 * enough when every clash shares a pole.
 */
export function uniqueOppositionPairs(
  pairs: readonly OppositionPair[],
  quotes?: ReadonlyMap<string, string>,
  max = 2,
): OppositionPair[] {
  const ranked = [...pairs].sort((left, right) => (right.gap ?? 0) - (left.gap ?? 0))
  const used = new Set<string>()
  const usedQuotes = new Set<string>()
  const out: OppositionPair[] = []
  for (const pair of ranked) {
    if (used.has(pair.a) || used.has(pair.b)) continue
    const quoteA = quotes?.get(pair.a)
    const quoteB = quotes?.get(pair.b)
    if (quoteA && usedQuotes.has(quoteA)) continue
    if (quoteB && usedQuotes.has(quoteB)) continue
    out.push(pair)
    used.add(pair.a)
    used.add(pair.b)
    if (quoteA) usedQuotes.add(quoteA)
    if (quoteB) usedQuotes.add(quoteB)
    if (out.length >= max) break
  }
  return out
}
