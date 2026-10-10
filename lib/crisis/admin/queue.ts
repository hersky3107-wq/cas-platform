import {
  ESTIMATE_USD_PER_REGION,
  QUEUE_SCOPES,
  QUEUE_STATUSES,
  RUN_ALL_MIN_STAGE,
  type AdminRegion,
  type QueueInsert,
  type QueueRow,
  type QueueScope,
  type QueueStatus,
} from './types'

const APPLY = 'Paste docs/crisis/APPLY_ENGINE_REQUESTS.md before using the engine queue.'

export function applyMissingMessage(error: string): string {
  if (/crisis_engine_requests|schema cache|does not exist/i.test(error)) return `${error}. ${APPLY}`
  return error
}

export function isQueueScope(value: unknown): value is QueueScope {
  return typeof value === 'string' && (QUEUE_SCOPES as readonly string[]).includes(value)
}

export function isQueueStatus(value: unknown): value is QueueStatus {
  return typeof value === 'string' && (QUEUE_STATUSES as readonly string[]).includes(value)
}

export function estimateQueueUsd(count: number, perRegion = ESTIMATE_USD_PER_REGION): number {
  if (!Number.isFinite(count) || count <= 0) return 0
  return Number((count * perRegion).toFixed(2))
}

export function regionsForRunAll(rows: AdminRegion[], minStage = RUN_ALL_MIN_STAGE): AdminRegion[] {
  return rows.filter((row) => row.stage >= minStage)
}

export function enqueueRegion(regionId: number, requestedBy: string | null): QueueInsert {
  if (!Number.isInteger(regionId) || regionId <= 0) throw new Error('region_id is required')
  return { region_id: regionId, scope: 'region', requested_by: requestedBy, status: 'queued' }
}

export function enqueueAll(requestedBy: string | null): QueueInsert {
  return { region_id: null, scope: 'all', requested_by: requestedBy, status: 'queued' }
}

/** Run-all inserts the batch marker plus one queued row per stage >= 3 region. */
export function enqueueRunAll(regionIds: number[], requestedBy: string | null): QueueInsert[] {
  const unique = [...new Set(regionIds.filter((id) => Number.isInteger(id) && id > 0))]
  return [enqueueAll(requestedBy), ...unique.map((id) => enqueueRegion(id, requestedBy))]
}

export function expandAllToRegions(request: QueueInsert, regionIds: number[]): QueueInsert[] {
  if (request.scope !== 'all') return [request]
  return regionIds.map((id) => enqueueRegion(id, request.requested_by))
}

export function canClaimNext(rows: Array<Pick<QueueRow, 'status'>>): boolean {
  return !rows.some((row) => row.status === 'running')
}

export function nextQueued(rows: QueueRow[]): QueueRow | null {
  const queued = rows
    .filter((row) => row.status === 'queued')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const region = queued.find((row) => row.scope === 'region')
  return region ?? queued[0] ?? null
}

export function markRunning(row: QueueRow, startedAt: string): QueueRow {
  return { ...row, status: 'running', started_at: startedAt, error: null }
}

export function markDone(row: QueueRow, finishedAt: string, runId: string | null): QueueRow {
  return { ...row, status: 'done', finished_at: finishedAt, run_id: runId, error: null }
}

export function markFailed(row: QueueRow, finishedAt: string, error: string): QueueRow {
  return { ...row, status: 'failed', finished_at: finishedAt, error }
}

export function groupQueue(rows: QueueRow[]): Record<QueueStatus, QueueRow[]> {
  const grouped: Record<QueueStatus, QueueRow[]> = { queued: [], running: [], done: [], failed: [] }
  for (const row of rows) grouped[row.status].push(row)
  return grouped
}
