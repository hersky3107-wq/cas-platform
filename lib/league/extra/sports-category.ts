/** Ledger category for the sports chip. Extra seats branch on this string. */
export function isSportsLedgerCategory(category: string | null | undefined): boolean {
  return (category ?? '').trim().toLowerCase() === 'sports'
}
