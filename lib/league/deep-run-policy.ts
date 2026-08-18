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
