/**
 * Admin-page election stage banners (calendar + clock only — no DB).
 */
import { KR_ELECTION_CALENDAR, krBlackoutBounds, type KrElectionCalendarRow } from './kr-calendar'
import { krElectionMilestoneAt } from './kr-election-alerts'

const DAY_MS = 86_400_000
const POST_CLOSE_MS = DAY_MS

export type KrElectionAdminBannerStage = 'prepare' | 'warn' | 'blackout' | 'post'

export type KrElectionAdminBanner = {
  electionId: string
  title: string
  stage: KrElectionAdminBannerStage
  color: 'yellow' | 'orange' | 'red' | 'green'
  text: string
  showToggle: boolean
}

function pollDayKstParts(pollCloseIso: string): { y: number; m: number; d: number } | null {
  const closeMs = Date.parse(pollCloseIso)
  if (!Number.isFinite(closeMs)) return null
  const closeKst = new Date(closeMs + 9 * 60 * 60 * 1000)
  return {
    y: closeKst.getUTCFullYear(),
    m: closeKst.getUTCMonth(),
    d: closeKst.getUTCDate(),
  }
}

export function formatKrElectionPollDateKst(pollCloseIso: string): string {
  const parts = pollDayKstParts(pollCloseIso)
  if (!parts) return pollCloseIso.slice(0, 10)
  const mm = String(parts.m + 1).padStart(2, '0')
  const dd = String(parts.d).padStart(2, '0')
  return `${parts.y}-${mm}-${dd}`
}

/** Whole KST calendar days from `atMs` until poll day (poll day = D-0). */
export function daysUntilKrPollDayKst(atMs: number, pollCloseIso: string): number | null {
  const parts = pollDayKstParts(pollCloseIso)
  if (!parts) return null
  const pollDayStartUtc = Date.UTC(parts.y, parts.m, parts.d) - 9 * 60 * 60 * 1000
  const nowKst = new Date(atMs + 9 * 60 * 60 * 1000)
  const todayStartUtc =
    Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate()) - 9 * 60 * 60 * 1000
  return Math.round((pollDayStartUtc - todayStartUtc) / DAY_MS)
}

export function krElectionAdminBannerForRow(
  row: KrElectionCalendarRow,
  atMs: number,
  switchOn: boolean,
): KrElectionAdminBanner | null {
  const d14 = krElectionMilestoneAt(row.pollCloseIso, 'd14')
  const d7 = krElectionMilestoneAt(row.pollCloseIso, 'd7')
  const d6 = krElectionMilestoneAt(row.pollCloseIso, 'd6')
  const close = krElectionMilestoneAt(row.pollCloseIso, 'poll_close')
  if (d14 == null || d7 == null || d6 == null || close == null) return null

  const d = daysUntilKrPollDayKst(atMs, row.pollCloseIso)
  const dn = d != null && d > 0 ? d : d === 0 ? 0 : null

  if (atMs >= d14 && atMs < d7) {
    const n = dn ?? 14
    return {
      electionId: row.raceKey,
      title: row.title,
      stage: 'prepare',
      color: 'yellow',
      text: `${row.title} 투표일 ${formatKrElectionPollDateKst(row.pollCloseIso)} — D-${n}. 차단 준비`,
      showToggle: false,
    }
  }

  if (atMs >= d7 && atMs < d6) {
    const n = dn ?? 7
    return {
      electionId: row.raceKey,
      title: row.title,
      stage: 'warn',
      color: 'orange',
      text: `${row.title} D-${n}. 다음 단계에서 차단 필요`,
      showToggle: false,
    }
  }

  const bounds = krBlackoutBounds(row.pollCloseIso)
  if (bounds && atMs >= d6 && atMs <= close) {
    return {
      electionId: row.raceKey,
      title: row.title,
      stage: 'blackout',
      color: 'red',
      text: `${row.title} 차단 기간 — 수동 차단 스위치: ${switchOn ? 'ON' : 'OFF'}`,
      showToggle: true,
    }
  }

  if (atMs > close && atMs <= close + POST_CLOSE_MS) {
    return {
      electionId: row.raceKey,
      title: row.title,
      stage: 'post',
      color: 'green',
      text: `${row.title} 투표 종료 — 차단 해제 가능`,
      showToggle: false,
    }
  }

  return null
}

export function listKrElectionAdminBanners(atMs: number, switchOn: boolean): KrElectionAdminBanner[] {
  const out: KrElectionAdminBanner[] = []
  for (const row of KR_ELECTION_CALENDAR) {
    const banner = krElectionAdminBannerForRow(row, atMs, switchOn)
    if (banner) out.push(banner)
  }
  return out
}
