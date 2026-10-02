/**
 * Operator risk alerts for registered KR elections (calendar only).
 * Does not auto-close surfaces — the operator flips the manual switch.
 */
import { KR_ELECTION_CALENDAR, krBlackoutBounds, type KrElectionCalendarRow } from './kr-calendar'
import { telegramConfigured } from '../manual-grade/telegram'

const TELEGRAM_API = 'https://api.telegram.org'
const DAY_MS = 86_400_000

let telegramOptionalLogged = false

/** Test seam. */
export function resetKrElectionTelegramOptionalLog(): void {
  telegramOptionalLogged = false
}

function logTelegramOptionalOnce(): void {
  if (telegramOptionalLogged) return
  telegramOptionalLogged = true
  console.log('telegram not configured; admin banner only')
}

export const KR_ELECTION_MILESTONES = ['d14', 'd7', 'd6', 'poll_close'] as const
export type KrElectionMilestone = (typeof KR_ELECTION_MILESTONES)[number]

export type KrElectionAlertStore = {
  hasSent(electionId: string, milestone: KrElectionMilestone): Promise<boolean>
  markSent(electionId: string, milestone: KrElectionMilestone): Promise<void>
}

export function krElectionMilestoneAt(pollCloseIso: string, milestone: KrElectionMilestone): number | null {
  if (milestone === 'poll_close') {
    const closeMs = Date.parse(pollCloseIso)
    return Number.isFinite(closeMs) ? closeMs : null
  }
  const bounds = krBlackoutBounds(pollCloseIso)
  if (!bounds) return null
  const d6 = Date.parse(bounds.fromIso)
  if (milestone === 'd6') return d6
  if (milestone === 'd7') return d6 - 1 * DAY_MS
  if (milestone === 'd14') return d6 - 8 * DAY_MS
  return null
}

export function dueKrElectionMilestones(row: KrElectionCalendarRow, atMs: number): KrElectionMilestone[] {
  const due: KrElectionMilestone[] = []
  for (const milestone of KR_ELECTION_MILESTONES) {
    const at = krElectionMilestoneAt(row.pollCloseIso, milestone)
    if (at != null && atMs >= at) due.push(milestone)
  }
  return due
}

export function buildKrElectionAlertText(title: string, milestone: KrElectionMilestone): string {
  if (milestone === 'd14') {
    return `⚠️ [선거 예고] ${title} D-14. 공직선거법 공표금지 창이 2주 후 시작됩니다.`
  }
  if (milestone === 'd7') {
    return `⚠️ [선거 예고] ${title} D-7. 공표금지 창이 일주일 후 시작됩니다.`
  }
  if (milestone === 'd6') {
    return `🚨 [선거 블랙아웃] ${title} D-6 진입, 지금 차단 필요`
  }
  return `✅ [선거] ${title} 투표 종료. 차단 해제 가능`
}

export function listKrElectionRiskWindows(atMs: number = Date.now()): Array<{
  electionId: string
  title: string
  fromIso: string
  toIso: string
}> {
  const out: Array<{ electionId: string; title: string; fromIso: string; toIso: string }> = []
  for (const row of KR_ELECTION_CALENDAR) {
    const bounds = krBlackoutBounds(row.pollCloseIso)
    if (!bounds) continue
    if (atMs >= Date.parse(bounds.fromIso) && atMs <= Date.parse(bounds.toIso)) {
      out.push({ electionId: row.raceKey, title: row.title, fromIso: bounds.fromIso, toIso: bounds.toIso })
    }
  }
  return out
}

const memorySent = new Set<string>()

export function memoryKrElectionAlertStore(): KrElectionAlertStore {
  return {
    async hasSent(electionId, milestone) {
      return memorySent.has(`${electionId}|${milestone}`)
    },
    async markSent(electionId, milestone) {
      memorySent.add(`${electionId}|${milestone}`)
    },
  }
}

/** Test seam. */
export function resetKrElectionAlertMemory(): void {
  memorySent.clear()
}

export async function dispatchKrElectionAlerts(opts: {
  atMs?: number
  store?: KrElectionAlertStore
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}): Promise<{ sent: Array<{ electionId: string; milestone: KrElectionMilestone }> }> {
  const atMs = opts.atMs ?? Date.now()
  const store = opts.store ?? memoryKrElectionAlertStore()
  const env = opts.env ?? process.env
  const fetchImpl = opts.fetchImpl ?? fetch
  const token = env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = env.TELEGRAM_ADMIN_CHAT_ID?.trim()
  if (!telegramConfigured(env) || !token || !chatId) {
    logTelegramOptionalOnce()
    return { sent: [] }
  }

  const sent: Array<{ electionId: string; milestone: KrElectionMilestone }> = []
  for (const row of KR_ELECTION_CALENDAR) {
    for (const milestone of dueKrElectionMilestones(row, atMs)) {
      if (await store.hasSent(row.raceKey, milestone)) continue
      try {
        const res = await fetchImpl(`${TELEGRAM_API}/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: buildKrElectionAlertText(row.title, milestone),
            disable_web_page_preview: true,
          }),
        })
        if (res.ok) {
          await store.markSent(row.raceKey, milestone)
          sent.push({ electionId: row.raceKey, milestone })
        }
      } catch {
        /* badge still shows */
      }
    }
  }
  return { sent }
}

export async function sendKrElectionTestAlert(opts: {
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}): Promise<{ sent: boolean; error?: string }> {
  const env = opts.env ?? process.env
  const token = env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = env.TELEGRAM_ADMIN_CHAT_ID?.trim()
  if (!token || !chatId) return { sent: false, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID missing' }
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '🧪 [선거 알림 테스트] 텔레그램 수신 확인. 이 메시지는 차단을 실행하지 않습니다.',
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) return { sent: false, error: `telegram HTTP ${res.status}` }
    return { sent: true }
  } catch (e: unknown) {
    return { sent: false, error: e instanceof Error ? e.message : 'telegram failed' }
  }
}
