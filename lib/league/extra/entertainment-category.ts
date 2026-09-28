/** Ledger category for the entertainment chip. Extra seats branch on this string. */
export function isEntertainmentLedgerCategory(category: string | null | undefined): boolean {
  const key = (category ?? '').trim().toLowerCase()
  return key === 'entertainment_awards' || key === 'entertainment'
}
