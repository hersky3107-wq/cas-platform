/**
 * Confirmed Korean elections used to derive 공직선거법 D-6 windows.
 * Add a row only when the poll date is published. Do not invent by-elections.
 *
 * 제9회 전국동시지방선거: 2026-06-03, poll close 18:00 KST.
 * Next presidential term after the 2025 snap election is outside a 3-month window.
 */

export type KrElectionCalendarRow = {
  raceKey: string
  title: string
  /** ISO instant of poll close. */
  pollCloseIso: string
}

export const KR_ELECTION_CALENDAR: readonly KrElectionCalendarRow[] = [
  {
    raceKey: 'KR:local:2026:nationwide',
    title: '제9회 전국동시지방선거',
    pollCloseIso: '2026-06-03T09:00:00.000Z',
  },
]

const DAY_MS = 86_400_000

/** D-6 00:00 KST through poll close. KST = UTC+9. */
export function raceBlackoutActive(pollCloseIso: string, atMs: number): boolean {
  const bounds = krBlackoutBounds(pollCloseIso)
  if (!bounds) return false
  return atMs >= Date.parse(bounds.fromIso) && atMs <= Date.parse(bounds.toIso)
}

export function krBlackoutBounds(pollCloseIso: string): { fromIso: string; toIso: string } | null {
  const closeMs = Date.parse(pollCloseIso)
  if (!Number.isFinite(closeMs)) return null
  const closeKst = new Date(closeMs + 9 * 60 * 60 * 1000)
  const y = closeKst.getUTCFullYear()
  const m = closeKst.getUTCMonth()
  const d = closeKst.getUTCDate()
  const pollDayKstMidnightUtc = Date.UTC(y, m, d) - 9 * 60 * 60 * 1000
  const fromMs = pollDayKstMidnightUtc - 6 * DAY_MS
  return { fromIso: new Date(fromMs).toISOString(), toIso: new Date(closeMs).toISOString() }
}
