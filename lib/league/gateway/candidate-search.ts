/**
 * Open-question candidate set. Perplexity may RETURN a field; it never PICKS
 * the three chips. Selection is deterministic:
 *
 *   1. Tokenize the search brief (commas / newlines / parentheticals).
 *   2. Treat each token as a lookup key into the adapter resolver.
 *   3. Keep only ids that resolve to a catalog entity.
 *   4. Order by the category catalog (flagship order), take at most 3.
 *
 * If step 3 is empty, refuse — do not invent names and do not fall back to
 * "the first three catalog chips".
 */

export const MAX_CANDIDATE_CHIPS = 3
export const MAX_PARSE_TOKENS = 16

export function extractCandidateTokens(text: string): string[] {
  const parts = text.split(/[\n,;|/•·]+/).map((s) => s.trim()).filter(Boolean)
  const tokens: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const t = raw.replace(/^[-*\d.)\s]+/, '').trim()
    if (!t || t.length > 80) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    tokens.push(t)
  }
  for (const part of parts) {
    const inners = [...part.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim())
    const outer = part.replace(/\([^)]+\)/g, '').trim()
    if (outer) push(outer)
    for (const inner of inners) push(inner)
    if (tokens.length >= MAX_PARSE_TOKENS) break
  }
  return tokens.slice(0, MAX_PARSE_TOKENS)
}

/** Catalog-order ∩ resolved set, first `limit` ids. Stable; ignores search rank. */
export function pickResolvedInCatalogOrder(
  resolvedIds: readonly string[],
  catalogOrder: readonly string[],
  limit: number = MAX_CANDIDATE_CHIPS,
): string[] {
  const set = new Set(resolvedIds)
  return catalogOrder.filter((id) => set.has(id)).slice(0, limit)
}

export function scanCatalogMentions(text: string, catalogOrder: readonly string[]): string[] {
  const hay = text.toLowerCase()
  const compactHay = hay.replace(/[^a-z0-9가-힣]/g, '')
  return catalogOrder.filter((id) => {
    const needle = id.toLowerCase()
    if (hay.includes(needle)) return true
    const compact = needle.replace(/[^a-z0-9가-힣]/g, '')
    return compact.length >= 3 && compactHay.includes(compact)
  })
}
