/** Ledger category for the politics chip. Extra seats and prompts branch on this string. */
export function isPoliticsLedgerCategory(category: string | null | undefined): boolean {
  return (category ?? '').trim().toLowerCase() === 'politics_election'
}
