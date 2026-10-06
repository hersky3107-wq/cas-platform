import { WIN_RATE_MIN_SAMPLE } from '../win-rate'
import { computeBoards, emptyBoards } from './compute'
import {
  boardSignature,
  categoriesForDoor,
  categoriesOfScopeKey,
  scopeCategories,
  scopeKey,
  selectRounds,
} from './filters'
import {
  BOARD_DOORS,
  BOARD_HORIZONS,
  BOARD_KEYS,
  BOARD_PERIODS,
  type BoardFilters,
  type BoardPrediction,
  type BoardRound,
  type BoardSet,
  type BoardsMeta,
  type BoardsResponse,
} from './types'

/**
 * Board cache orchestration (pure; the store is injected). A rebuild computes
 * every signature that selects at least one round, writes one row per
 * (board, signature), then drops rows from older rebuilds. A signature with
 * no row selects no rounds, so the read path answers it with empty boards
 * instead of computing.
 */

export const META_BOARD = '_meta'
export const META_SIGNATURE = 'meta'
export const SUMMARY_BOARD = '_summary'
export const LEASE_BOARD = '_lease'
export const LEASE_SIGNATURE = 'refresh'
export const DEFAULT_LEASE_MS = 5 * 60 * 1000
const UPSERT_CHUNK = 100

export type CacheRow = {
  board: string
  signature: string
  payload: unknown
  refresh_id: string
  computed_at: string
}

export interface BoardCacheStore {
  /** Atomic insert-if-absent of the lease row; false when another rebuild holds it. */
  acquireLease(refreshId: string, untilIso: string, nowIso: string): Promise<boolean>
  releaseLease(refreshId: string): Promise<void>
  upsert(rows: CacheRow[]): Promise<void>
  /** Deletes every non-lease row whose refresh_id differs. Returns the count. */
  deleteStale(refreshId: string): Promise<number>
  readSignature(signature: string): Promise<CacheRow[]>
  readMeta(): Promise<CacheRow | null>
}

export type BoardSource = { rounds: BoardRound[]; predictions: BoardPrediction[] }

type MetaPayload = { categories: string[]; generatedAt: string; signatures: number }

export type CacheEntry = { signature: string; rounds: number; boards: BoardSet }

export function categoriesWithData(rounds: readonly BoardRound[]): string[] {
  return [...new Set(rounds.map((round) => round.category))].sort()
}

/** Every canonical scope a public request can land on. */
export function plannedScopes(withData: readonly string[]): string[] {
  const keys = new Set<string>()
  for (const door of BOARD_DOORS) keys.add(scopeKey(categoriesForDoor(door, withData), withData))
  for (const category of withData) keys.add(scopeKey([category], withData))
  keys.delete('none')
  return [...keys].sort()
}

export function computeEntry(
  source: BoardSource,
  categories: readonly string[],
  filters: Pick<BoardFilters, 'horizon' | 'period'>,
  nowMs: number,
): { rounds: number; boards: BoardSet } {
  const selected = selectRounds(source.rounds, { categories, horizon: filters.horizon, period: filters.period, nowMs })
  return { rounds: selected.length, boards: computeBoards(selected, source.predictions, nowMs) }
}

export function planRefresh(source: BoardSource, nowMs: number): { withData: string[]; entries: CacheEntry[] } {
  const withData = categoriesWithData(source.rounds)
  const entries: CacheEntry[] = []
  for (const scope of plannedScopes(withData)) {
    const categories = categoriesOfScopeKey(scope, withData)
    for (const horizon of BOARD_HORIZONS) {
      for (const period of BOARD_PERIODS) {
        const entry = computeEntry(source, categories, { horizon, period }, nowMs)
        if (entry.rounds === 0) continue
        entries.push({ signature: boardSignature(scope, horizon, period), ...entry })
      }
    }
  }
  return { withData, entries }
}

export function entryRows(entry: CacheEntry, refreshId: string, computedAt: string): CacheRow[] {
  const rows: CacheRow[] = BOARD_KEYS.map((board) => ({
    board,
    signature: entry.signature,
    payload: entry.boards[board],
    refresh_id: refreshId,
    computed_at: computedAt,
  }))
  rows.push({
    board: SUMMARY_BOARD,
    signature: entry.signature,
    payload: { rounds: entry.rounds },
    refresh_id: refreshId,
    computed_at: computedAt,
  })
  return rows
}

export type RefreshResult =
  | { ok: true; refreshId: string; signatures: number; rows: number; deleted: number; categories: string[] }
  | { ok: false; reason: 'busy' }

export async function refreshBoardCache(
  store: BoardCacheStore,
  load: () => Promise<BoardSource>,
  opts: { nowMs: number; refreshId: string; leaseMs?: number },
): Promise<RefreshResult> {
  const nowIso = new Date(opts.nowMs).toISOString()
  const until = new Date(opts.nowMs + (opts.leaseMs ?? DEFAULT_LEASE_MS)).toISOString()
  if (!(await store.acquireLease(opts.refreshId, until, nowIso))) return { ok: false, reason: 'busy' }
  try {
    const source = await load()
    const { withData, entries } = planRefresh(source, opts.nowMs)
    const rows = entries.flatMap((entry) => entryRows(entry, opts.refreshId, nowIso))
    const meta: MetaPayload = { categories: withData, generatedAt: nowIso, signatures: entries.length }
    rows.push({ board: META_BOARD, signature: META_SIGNATURE, payload: meta, refresh_id: opts.refreshId, computed_at: nowIso })
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) await store.upsert(rows.slice(i, i + UPSERT_CHUNK))
    const deleted = await store.deleteStale(opts.refreshId)
    return {
      ok: true,
      refreshId: opts.refreshId,
      signatures: entries.length,
      rows: rows.length,
      deleted,
      categories: withData,
    }
  } finally {
    await store.releaseLease(opts.refreshId)
  }
}

function readMetaPayload(row: CacheRow | null): MetaPayload | null {
  const payload = row?.payload as Partial<MetaPayload> | undefined
  if (!payload || !Array.isArray(payload.categories) || typeof payload.generatedAt !== 'string') return null
  return { categories: payload.categories, generatedAt: payload.generatedAt, signatures: Number(payload.signatures) || 0 }
}

export function assembleBoards(rows: readonly CacheRow[], nowMs: number): { boards: BoardSet; rounds: number } {
  const boards = emptyBoards(nowMs) as Record<string, unknown>
  let rounds = 0
  for (const row of rows) {
    if (row.board === SUMMARY_BOARD) rounds = Number((row.payload as { rounds?: unknown })?.rounds) || 0
    else if ((BOARD_KEYS as readonly string[]).includes(row.board) && row.payload != null) boards[row.board] = row.payload
  }
  return { boards: boards as BoardSet, rounds }
}

function response(
  filters: BoardFilters,
  signature: string,
  meta: BoardsMeta,
  boards: BoardSet,
  pending: boolean,
): BoardsResponse {
  return { kind: 'boards', signature, filters, pending, meta, boards }
}

export type ReadBoardsOptions = {
  filters: BoardFilters
  /** Viewer jurisdiction allow-list; null for the admin view. */
  visible: readonly string[] | null
  nowMs: number
  /**
   * Computes a scope no rebuild plans (a jurisdiction-narrowed category set).
   * The result is written back under the current refresh id.
   */
  fill?: (categories: readonly string[], filters: BoardFilters) => Promise<{ rounds: number; boards: BoardSet }>
}

export async function readBoards(store: BoardCacheStore, opts: ReadBoardsOptions): Promise<BoardsResponse> {
  const metaRow = await store.readMeta()
  const meta = readMetaPayload(metaRow)
  if (!meta || !metaRow) {
    return response(
      opts.filters,
      '',
      { generatedAt: null, categories: [], minSample: WIN_RATE_MIN_SAMPLE, rounds: 0 },
      emptyBoards(opts.nowMs),
      true,
    )
  }
  const visibleData = opts.visible ? meta.categories.filter((c) => opts.visible!.includes(c)) : meta.categories
  const categories = scopeCategories(opts.filters, meta.categories, opts.visible)
  const scope = scopeKey(categories, meta.categories)
  const signature = boardSignature(scope, opts.filters.horizon, opts.filters.period)
  const baseMeta = { generatedAt: meta.generatedAt, categories: visibleData, minSample: WIN_RATE_MIN_SAMPLE }
  if (scope === 'none') return response(opts.filters, signature, { ...baseMeta, rounds: 0 }, emptyBoards(opts.nowMs), false)

  const rows = await store.readSignature(signature)
  if (rows.length > 0) {
    const { boards, rounds } = assembleBoards(rows, opts.nowMs)
    return response(opts.filters, signature, { ...baseMeta, rounds }, boards, false)
  }
  if (scope.startsWith('set:') && opts.fill) {
    const filled = await opts.fill(categoriesOfScopeKey(scope, meta.categories), opts.filters)
    if (filled.rounds > 0) {
      await store.upsert(entryRows({ signature, ...filled }, metaRow.refresh_id, metaRow.computed_at))
    }
    return response(opts.filters, signature, { ...baseMeta, rounds: filled.rounds }, filled.boards, false)
  }
  return response(opts.filters, signature, { ...baseMeta, rounds: 0 }, emptyBoards(opts.nowMs), false)
}

/** Admin preview over a live source (test rounds included); never cached. */
export function liveBoards(source: BoardSource, filters: BoardFilters, nowMs: number): BoardsResponse {
  const withData = categoriesWithData(source.rounds)
  const categories = scopeCategories(filters, withData, null)
  const entry = computeEntry(source, categories, filters, nowMs)
  return response(
    filters,
    `live|${boardSignature(scopeKey(categories, withData), filters.horizon, filters.period)}`,
    { generatedAt: new Date(nowMs).toISOString(), categories: withData, minSample: WIN_RATE_MIN_SAMPLE, rounds: entry.rounds },
    entry.boards,
    false,
  )
}
