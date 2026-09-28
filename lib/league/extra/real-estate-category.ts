export function isRealEstateLedgerCategory(category: string | null | undefined): boolean {
  const key = category?.trim().toLowerCase()
  return key === 'real_estate'
}
