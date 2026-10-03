/**
 * Evening KRX refresh decision. Pure — the cron supplies storage and the
 * existing ensureKrxFlowsDay / ensureKrxDay calls, which already throttle
 * through getKrxSession. A run never fetches more than one date, and it
 * calls the flows bundle at most once.
 *
 * Window: the civil evening of the session that just completed, 18:00 inclusive
 * through 23:00 exclusive, Asia/Seoul. While the day is not stored, retry at
 * most once per hour. Once both flows and daily bars are stored, later runs
 * do not call KRX (ensureKrxFlowsDay's cached path still hits short-balance,
 * so a stored day must skip that function).
 */

import { kstClock, lastCompletedKrxSession } from './krx-calendar'

export const KRX_DAILY_REFRESH = {
  startHourKst: 18,
  endHourKst: 23,
  retryMs: 60 * 60 * 1000,
  /** planKrxFlowsCalls is 2 markets × (5 investors + short volume + foreign own + short balance). */
  flowsRequestsPerAttempt: 16,
} as const

export type KrxRefreshLog = {
  date: string
  lastAttemptMs: number
  published: boolean
} | null

export type KrxDailyRefreshSkip =
  | 'calendar'
  | 'not_session_day'
  | 'outside_window'
  | 'published'
  | 'hourly_backoff'
  | 'log_unavailable'

export type KrxDailyRefreshDecision =
  | { action: 'skip'; reason: Exclude<KrxDailyRefreshSkip, 'log_unavailable'> }
  | { action: 'fetch'; date: string }

export type KrxDailyRefreshIo = {
  readLog: (date: string) => Promise<KrxRefreshLog>
  stored: (date: string) => Promise<{ flows: boolean; daily: boolean }>
  /** False when another worker already claimed this hour. */
  claimAttempt: (date: string, atMs: number) => Promise<boolean>
  markPublished: (date: string, atMs: number) => Promise<void>
  ensureFlows: (date: string) => Promise<void>
  ensureDaily: (date: string) => Promise<void>
}

export type KrxDailyRefreshResult = {
  action: 'skip' | 'already_stored' | 'fetched'
  reason?: KrxDailyRefreshSkip
  date?: string
  flowRequests: number
}

export function krxRefreshWindow(
  now: Date,
): { date: string } | { skip: 'calendar' | 'not_session_day' | 'outside_window' } {
  const session = lastCompletedKrxSession(now)
  if (!session.ok) return { skip: 'calendar' }
  const clock = kstClock(now)
  if (clock.date !== session.date) return { skip: 'not_session_day' }
  if (clock.hour < KRX_DAILY_REFRESH.startHourKst || clock.hour >= KRX_DAILY_REFRESH.endHourKst) {
    return { skip: 'outside_window' }
  }
  return { date: session.date }
}

export function decideKrxDailyRefresh(now: Date, log: KrxRefreshLog): KrxDailyRefreshDecision {
  const window = krxRefreshWindow(now)
  if ('skip' in window) return { action: 'skip', reason: window.skip }
  if (log?.published && log.date === window.date) return { action: 'skip', reason: 'published' }
  if (
    log &&
    log.date === window.date &&
    !log.published &&
    now.getTime() - log.lastAttemptMs < KRX_DAILY_REFRESH.retryMs
  ) {
    return { action: 'skip', reason: 'hourly_backoff' }
  }
  return { action: 'fetch', date: window.date }
}

export async function runKrxDailyRefresh(now: Date, io: KrxDailyRefreshIo): Promise<KrxDailyRefreshResult> {
  const window = krxRefreshWindow(now)
  if ('skip' in window) return { action: 'skip', reason: window.skip, flowRequests: 0 }
  let log: KrxRefreshLog
  try {
    log = await io.readLog(window.date)
  } catch {
    return { action: 'skip', reason: 'log_unavailable', flowRequests: 0 }
  }
  const decision = decideKrxDailyRefresh(now, log)
  if (decision.action === 'skip') return { action: 'skip', reason: decision.reason, flowRequests: 0 }
  const present = await io.stored(decision.date)
  if (present.flows && present.daily) {
    await io.markPublished(decision.date, now.getTime())
    return { action: 'already_stored', date: decision.date, flowRequests: 0 }
  }
  const won = await io.claimAttempt(decision.date, now.getTime())
  if (!won) return { action: 'skip', reason: 'hourly_backoff', date: decision.date, flowRequests: 0 }
  if (!present.flows) await io.ensureFlows(decision.date)
  if (!present.daily) await io.ensureDaily(decision.date)
  const after = await io.stored(decision.date)
  if (after.flows && after.daily) await io.markPublished(decision.date, now.getTime())
  return {
    action: 'fetched',
    date: decision.date,
    flowRequests: present.flows ? 0 : KRX_DAILY_REFRESH.flowsRequestsPerAttempt,
  }
}
