/**
 * Pure decision helpers for durable deep-analysis runs.
 * Kept out of `deep-store.ts` so tests do not import `server-only`.
 */

export type DeepRunAction = 'start' | 'replay' | 'resume' | 'restart' | 'finish_refund'

export function decideDeepRunAction(row: {
  status: 'running' | 'done' | 'error'
  result: unknown
  refunded: boolean
} | null): DeepRunAction {
  if (!row) return 'start'
  if (row.status === 'done' && row.result) return 'replay'
  if (row.status === 'running') return 'resume'
  if (row.status === 'error' && !row.refunded) return 'finish_refund'
  if (row.status === 'error' && row.refunded) return 'restart'
  return 'resume'
}

export function runIsBusy(row: { busy_until: string | null }): boolean {
  if (!row.busy_until) return false
  const until = Date.parse(row.busy_until)
  return Number.isFinite(until) && until > Date.now()
}

/**
 * Claim/charge now happen BEFORE the (round + research + price) context is
 * built, so a claimed-and-charged row has no pipeline state yet. This marker
 * lives in the row's `state` column (no new column / migration needed) and
 * distinguishes "charged, waiting to be seeded" from "seeded, mid-pipeline".
 */
export const MAX_SEED_ATTEMPTS = 3

export type UnseededState = {
  __unseeded: true
  seedAttempts: number
  lastSeedError?: string
}

export function placeholderUnseededState(): UnseededState {
  return { __unseeded: true, seedAttempts: 0 }
}

export function isUnseededState(state: unknown): state is UnseededState {
  return (
    !!state &&
    typeof state === 'object' &&
    (state as Record<string, unknown>).__unseeded === true &&
    typeof (state as Record<string, unknown>).seedAttempts === 'number'
  )
}

/** Records one more failed seed attempt, keeping the prior count and cause chain. */
export function nextUnseededState(state: unknown, error: string): UnseededState {
  const attempts = isUnseededState(state) ? state.seedAttempts : 0
  return { __unseeded: true, seedAttempts: attempts + 1, lastSeedError: error }
}
