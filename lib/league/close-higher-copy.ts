/**
 * Catalog close-higher copy for 24h spots. Names both bar dates so a 1d
 * round cannot be read as "today's live quote vs today's close".
 */
export function closeHigherPropositionEn(instrument: string, resolveDate: string, anchorDate: string): string {
  return `Will ${instrument} close higher on ${resolveDate} than its ${anchorDate} close?`
}

export function closeHigherPropositionKo(instrument: string, resolveDate: string, anchorDate: string): string {
  return `${anchorDate} 종가 대비 ${resolveDate} 종가 — ${instrument}이 더 높게 마감할까?`
}
