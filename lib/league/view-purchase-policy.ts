/**
 * Pure policy for paid league VIEW surfaces (leaderboard + record room).
 * No DB — unit-testable. Money amounts live in `lib/league/credits.ts`.
 */

export type LeagueViewProduct = 'leaderboard' | 'record_room'

/** One record-room purchase covers this many most-recently-resolved rounds. */
export const RECORD_ROOM_PURCHASE_ROUND_LIMIT = 30

/** Page size inside a purchased record-room window. */
export const RECORD_ROOM_PURCHASED_PAGE_SIZE = 20

export type RecordRoomWindow = {
  asOf: string
  roundLimit: number
}

export type LockedViewPayload = {
  locked: true
  product: LeagueViewProduct
  required: number
  code: 'purchase_required'
}

export function lockedViewPayload(product: LeagueViewProduct, required: number): LockedViewPayload {
  return { locked: true, product, required, code: 'purchase_required' }
}

export function isLockedViewPayload(body: unknown): body is LockedViewPayload {
  if (!body || typeof body !== 'object') return false
  const row = body as { locked?: unknown; product?: unknown; required?: unknown; code?: unknown }
  return (
    row.locked === true &&
    (row.product === 'leaderboard' || row.product === 'record_room') &&
    typeof row.required === 'number' &&
    row.code === 'purchase_required'
  )
}

export type ArchiveQuery = {
  page: number
  pageSize: number
  modelId?: string
  from?: string
  to?: string
  format?: 'json' | 'csv'
}

/**
 * Clamp a listing query to a purchased window. Pagination cannot walk past
 * `windowRoundCount`. Date filters are clipped to [windowFrom, windowTo]
 * when those bounds are known. CSV is never a GET listing — the caller
 * strips `format` here so a query-string `format=csv` cannot widen the GET.
 */
export function clampRecordRoomQuery(
  q: ArchiveQuery,
  window: { roundCount: number; from?: string; to?: string }
): ArchiveQuery {
  const maxPageSize = Math.max(1, Math.min(RECORD_ROOM_PURCHASED_PAGE_SIZE, window.roundCount || RECORD_ROOM_PURCHASED_PAGE_SIZE))
  const pageSize = Math.max(1, Math.min(q.pageSize, maxPageSize))
  const totalPages = window.roundCount > 0 ? Math.max(1, Math.ceil(window.roundCount / pageSize)) : 1
  const page = Math.max(1, Math.min(q.page, totalPages))

  let from = q.from?.trim() || undefined
  let to = q.to?.trim() || undefined
  if (window.from && from && from < window.from) from = window.from
  if (window.to && to && to > window.to) to = window.to
  if (window.from && !from) {
    /* keep unspecified — the ID list already bounds the query */
  }

  return {
    page,
    pageSize,
    modelId: q.modelId?.trim() || undefined,
    from,
    to,
    format: 'json',
  }
}
