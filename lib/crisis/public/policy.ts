export const FRESH_CARD_MS = 24 * 60 * 60 * 1000
export const DEEP_TIMEOUT_MS = 60 * 60 * 1000
export const DEEP_WAIT_COPY = '분석 중, 최대 15분'
export const DEEP_FAILED_COPY = '분석 실패, 크레딧 환불됨'

export const MAX_ACTIVE_USER_REQUESTS = 1
export const MAX_DAILY_USER_REQUESTS = 3

export type DeepAction = 'replay' | 'pending' | 'cache' | 'start' | 'failed'

export function isFreshCard(at: string | null | undefined, now: Date): boolean {
  if (!at) return false
  const t = Date.parse(at)
  return Number.isFinite(t) && now.getTime() - t < FRESH_CARD_MS
}

export function isTimedOut(createdAt: string | null | undefined, now = new Date()): boolean {
  if (!createdAt) return false
  const t = Date.parse(createdAt)
  return Number.isFinite(t) && now.getTime() - t >= DEEP_TIMEOUT_MS
}

export function isPublicRun(publishedHypothesisIds: unknown): boolean {
  return Array.isArray(publishedHypothesisIds) && publishedHypothesisIds.length > 0
}

export function decideDeepAction(opts: {
  ownStatus: 'queued' | 'running' | 'done' | 'failed' | null
  ownHasCard: boolean
  ownCreatedAt?: string | null
  freshPublicAt: string | null
  now: Date
}): DeepAction {
  if (opts.ownStatus === 'failed') return 'failed'
  if (opts.ownStatus === 'queued' || opts.ownStatus === 'running') {
    if (isTimedOut(opts.ownCreatedAt, opts.now)) return 'failed'
    return 'pending'
  }
  if (opts.ownStatus === 'done' && opts.ownHasCard) return 'replay'
  if (isFreshCard(opts.freshPublicAt, opts.now)) return 'cache'
  return 'start'
}

export function shouldPulse(stage: number): boolean {
  return stage >= 4
}
