import type { JurisdictionGroup } from './types'

/**
 * `politics_election` auto-off during election blackout windows — layered
 * ON TOP of `matrix.ts` (a jurisdiction can be "on" in the matrix and still
 * be temporarily denied here). DATA ONLY.
 *
 * `group: 'ALL'` applies to every jurisdiction. Dates are illustrative
 * placeholders demonstrating the mechanism — populate real dates per
 * election/jurisdiction before this category goes live for real users.
 */
export type ElectionBlackoutWindow = {
  group: JurisdictionGroup | 'ALL'
  fromIso: string
  toIso: string
  note: string
}

export const POLITICS_ELECTION_BLACKOUT_WINDOWS: readonly ElectionBlackoutWindow[] = [
  // Example placeholder only — replace/extend with real, confirmed windows
  // per jurisdiction before politics_election ships for real users.
  // { group: 'KR', fromIso: '2027-05-25T00:00:00Z', toIso: '2027-06-04T00:00:00Z', note: 'KR presidential election cooling-off period (placeholder).' },
]

export function isPoliticsBlackoutActive(group: JurisdictionGroup, atMs: number): boolean {
  return POLITICS_ELECTION_BLACKOUT_WINDOWS.some((w) => {
    if (w.group !== 'ALL' && w.group !== group) return false
    return atMs >= new Date(w.fromIso).getTime() && atMs <= new Date(w.toIso).getTime()
  })
}
