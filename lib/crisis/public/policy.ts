export const FRESH_CARD_MS = 24 * 60 * 60 * 1000
export const DEEP_WAIT_COPY = '분석 중, 최대 15분'

export type DeepAction = 'replay' | 'pending' | 'cache' | 'start'

export function isFreshCard(at: string | null | undefined, now: Date): boolean {
  if (!at) return false
  const t = Date.parse(at)
  return Number.isFinite(t) && now.getTime() - t < FRESH_CARD_MS
}

export function isPublicRun(publishedHypothesisIds: unknown): boolean {
  return Array.isArray(publishedHypothesisIds) && publishedHypothesisIds.length > 0
}

export function decideDeepAction(opts: {
  ownStatus: 'queued' | 'running' | 'done' | 'failed' | null
  ownHasCard: boolean
  freshPublicAt: string | null
  now: Date
}): DeepAction {
  if (opts.ownStatus === 'queued' || opts.ownStatus === 'running') return 'pending'
  if (opts.ownStatus === 'done' && opts.ownHasCard) return 'replay'
  if (isFreshCard(opts.freshPublicAt, opts.now)) return 'cache'
  return 'start'
}

export function shouldPulse(stage: number): boolean {
  return stage >= 4
}
