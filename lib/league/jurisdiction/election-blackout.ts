import type { JurisdictionGroup } from './types'
import { KR_ELECTION_CALENDAR, krBlackoutBounds } from '../politics/kr-calendar'

/**
 * `politics_election` blackout windows — layered ON TOP of `matrix.ts`.
 *
 * Race-scoped windows (Korean 공직선거법 D-6) do NOT hide the whole category.
 * They block only KR-jurisdiction races for KR users (declared or IP).
 * US and other global races stay open. Category-wide windows (`scope: 'category'`)
 * still deny the chip for that group.
 */
export type ElectionBlackoutWindow = {
  group: JurisdictionGroup | 'ALL'
  fromIso: string
  toIso: string
  note: string
  scope: 'category' | 'race'
  raceKey: string
  title: string
  /** Race jurisdiction this window governs. 'KR' = Korean elections only. */
  raceJurisdiction: string
}

function fromCalendar(): ElectionBlackoutWindow[] {
  const out: ElectionBlackoutWindow[] = []
  for (const row of KR_ELECTION_CALENDAR) {
    const bounds = krBlackoutBounds(row.pollCloseIso)
    if (!bounds) continue
    out.push({
      group: 'KR',
      fromIso: bounds.fromIso,
      toIso: bounds.toIso,
      note: `${row.title} 공직선거법 제108조 공표금지 (D-6 ~ 투표마감)`,
      scope: 'race',
      raceKey: row.raceKey,
      title: row.title,
      raceJurisdiction: 'KR',
    })
  }
  return out
}

export const POLITICS_ELECTION_BLACKOUT_WINDOWS: readonly ElectionBlackoutWindow[] = fromCalendar()

function windowHits(w: ElectionBlackoutWindow, group: JurisdictionGroup | 'ALL', atMs: number): boolean {
  if (w.group !== 'ALL' && w.group !== group) return false
  return atMs >= new Date(w.fromIso).getTime() && atMs <= new Date(w.toIso).getTime()
}

/** Category-wide deny only. Race windows are enforced on the resolved race. */
export function isPoliticsBlackoutActive(group: JurisdictionGroup, atMs: number): boolean {
  return POLITICS_ELECTION_BLACKOUT_WINDOWS.some(
    (w) => w.scope === 'category' && windowHits(w, group, atMs),
  )
}

export function activeRaceBlackouts(atMs: number, raceJurisdiction = 'KR'): ElectionBlackoutWindow[] {
  return POLITICS_ELECTION_BLACKOUT_WINDOWS.filter(
    (w) =>
      w.scope === 'race' &&
      w.raceJurisdiction === raceJurisdiction &&
      atMs >= new Date(w.fromIso).getTime() &&
      atMs <= new Date(w.toIso).getTime(),
  )
}

export function isKrRaceBlackoutActive(atMs: number): boolean {
  return activeRaceBlackouts(atMs, 'KR').length > 0
}
