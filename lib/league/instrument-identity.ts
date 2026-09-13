/**
 * Catalog identity — HTTP 200 is not identity.
 *
 * Twelve Data returns 200 for `SPX` as "Stellar AfricaGold Inc." ($0.12)
 * and for `NDX` as "Nordex SE ADR". Those are not index levels. A 200 with
 * the wrong name is worse than a 404: paid model calls would run and the
 * round would grade on a penny stock.
 *
 * Every catalog chip declares `expected_name` tokens. Fetch and grade
 * paths refuse a quote whose resolved name does not contain every token.
 * Ambiguous index tickers are banned even before the HTTP call.
 */

/** Tickers Twelve Data silently binds to an unrelated equity. Never catalog. */
export const POISON_TICKERS = ['SPX', 'NDX', 'DJI', 'RUT'] as const

export function isPoisonTicker(instrument: string): boolean {
  const base = instrument.trim().toUpperCase().split(':')[0] ?? ''
  return (POISON_TICKERS as readonly string[]).includes(base)
}

/**
 * True when every token appears in the vendor's instrument name
 * (case-insensitive). Empty tokens or a missing name never match.
 */
export function quoteMatchesIdentity(
  resolvedName: string | null | undefined,
  tokens: readonly string[],
): boolean {
  if (!resolvedName?.trim() || tokens.length === 0) return false
  const hay = resolvedName.toLowerCase()
  return tokens.every((t) => t.trim().length > 0 && hay.includes(t.trim().toLowerCase()))
}

export function identityMismatchMessage(
  instrument: string,
  resolvedName: string | null | undefined,
  tokens: readonly string[],
): string {
  if (isPoisonTicker(instrument)) {
    return `refusing ${instrument}: ambiguous ticker that Twelve Data resolves to an unrelated security (not an index level)`
  }
  return `identity mismatch for ${instrument}: expected name to include [${tokens.join(', ')}], got ${resolvedName ?? '(missing name)'}`
}
