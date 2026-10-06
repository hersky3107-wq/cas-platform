import 'server-only'

import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/server'
import {
  computeEntry,
  LEASE_BOARD,
  LEASE_SIGNATURE,
  liveBoards,
  META_BOARD,
  META_SIGNATURE,
  readBoards,
  refreshBoardCache,
  type BoardCacheStore,
  type BoardSource,
  type CacheRow,
  type RefreshResult,
} from './cache'
import { emptyBoards } from './compute'
import { isBoardRound, toBoardPrediction, toBoardRound, type PredictionDbRow, type RoundDbRow } from './rows'
import type { BoardFilters, BoardPrediction, BoardsResponse } from './types'
import { WIN_RATE_MIN_SAMPLE } from '../win-rate'

const TABLE = 'league_board_cache'
const PAGE = 1000
const ROUND_CHUNK = 150
/** Hourly ticks inside the grading window skip a rebuild younger than this. */
export const BOARD_CACHE_MAX_AGE_MS = 50 * 60 * 1000

const ROUND_COLUMNS =
  'id, category, horizon, instrument, subject_label, resolves_at, resolved_at, actual_outcome, grading_status, is_test, consensus_is_correct, consensus_aggregate_probability, anchor_session_date, resolution_session_date'
const PREDICTION_COLUMNS = 'round_id, model_id, league_tier, camp, brand, predicted_direction, predicted_value, is_correct'

export function isMissingBoardCacheTable(message: string | undefined): boolean {
  return Boolean(message && message.includes(TABLE) && /does not exist|schema cache|could not find/i.test(message))
}

function fail(op: string, message: string): never {
  throw new Error(`league board cache ${op}: ${message}`)
}

export function supabaseBoardCacheStore(): BoardCacheStore {
  return {
    async acquireLease(refreshId, untilIso, nowIso) {
      await supabaseAdmin.from(TABLE).delete().eq('board', LEASE_BOARD).lt('computed_at', nowIso)
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .upsert(
          { board: LEASE_BOARD, signature: LEASE_SIGNATURE, payload: {}, refresh_id: refreshId, computed_at: untilIso },
          { onConflict: 'board,signature', ignoreDuplicates: true },
        )
        .select('refresh_id')
      if (error) fail('lease', error.message)
      return (data ?? []).some((row) => (row as { refresh_id: string }).refresh_id === refreshId)
    },
    async releaseLease(refreshId) {
      await supabaseAdmin.from(TABLE).delete().eq('board', LEASE_BOARD).eq('refresh_id', refreshId)
    },
    async upsert(rows) {
      const { error } = await supabaseAdmin.from(TABLE).upsert(rows, { onConflict: 'board,signature' })
      if (error) fail('upsert', error.message)
    },
    async deleteStale(refreshId) {
      const { count, error } = await supabaseAdmin
        .from(TABLE)
        .delete({ count: 'exact' })
        .neq('refresh_id', refreshId)
        .neq('board', LEASE_BOARD)
      if (error) fail('cleanup', error.message)
      return count ?? 0
    },
    async readSignature(signature) {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select('board, signature, payload, refresh_id, computed_at')
        .eq('signature', signature)
      if (error) fail('read', error.message)
      return (data ?? []) as CacheRow[]
    },
    async readMeta() {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select('board, signature, payload, refresh_id, computed_at')
        .eq('board', META_BOARD)
        .eq('signature', META_SIGNATURE)
        .maybeSingle()
      if (error) fail('meta', error.message)
      return (data as CacheRow | null) ?? null
    },
  }
}

async function fetchRounds(includeTest: boolean): Promise<RoundDbRow[]> {
  const out: RoundDbRow[] = []
  for (let from = 0; ; from += PAGE) {
    let query = supabaseAdmin
      .from('prediction_rounds')
      .select(ROUND_COLUMNS)
      .neq('grading_status', 'voided')
      .not('actual_outcome', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (!includeTest) query = query.eq('is_test', false)
    const { data, error } = await query
    if (error) fail('rounds', error.message)
    out.push(...((data ?? []) as RoundDbRow[]))
    if (!data || data.length < PAGE) return out
  }
}

async function fetchPredictionPage(roundIds: string[], from: number, withLens: boolean) {
  return supabaseAdmin
    .from('model_predictions')
    .select(withLens ? `${PREDICTION_COLUMNS}, analysis_lens` : PREDICTION_COLUMNS)
    .in('round_id', roundIds)
    .not('is_correct', 'is', null)
    .order('id')
    .range(from, from + PAGE - 1)
}

async function fetchPredictions(roundIds: string[]): Promise<BoardPrediction[]> {
  const out: BoardPrediction[] = []
  let withLens = true
  for (let i = 0; i < roundIds.length; i += ROUND_CHUNK) {
    const chunk = roundIds.slice(i, i + ROUND_CHUNK)
    for (let from = 0; ; from += PAGE) {
      let { data, error } = await fetchPredictionPage(chunk, from, withLens)
      if (error && withLens && /analysis_lens/i.test(error.message)) {
        withLens = false
        ;({ data, error } = await fetchPredictionPage(chunk, from, false))
      }
      if (error) fail('predictions', error.message)
      for (const row of (data ?? []) as unknown as PredictionDbRow[]) {
        const mapped = toBoardPrediction(row)
        if (mapped) out.push(mapped)
      }
      if (!data || data.length < PAGE) break
    }
  }
  return out
}

/** Public graded rounds (or every graded round for the admin preview) and their graded calls. */
export async function loadBoardSource(opts: { includeTest?: boolean } = {}): Promise<BoardSource> {
  const rows = (await fetchRounds(Boolean(opts.includeTest))).filter((row) => isBoardRound(row, opts))
  const rounds = rows.map(toBoardRound)
  const predictions = await fetchPredictions(rounds.map((round) => round.id))
  return { rounds, predictions }
}

export type LeaderboardRefresh =
  | RefreshResult
  | { ok: false; reason: 'fresh'; ageMs: number }
  | { ok: false; reason: 'missing_table' }

/**
 * Rebuilds every board. `maxAgeMs` skips a rebuild while the last one is
 * younger than that (the hourly cron passes it; grading batches do not).
 */
export async function refreshLeaderboardCache(opts: { maxAgeMs?: number; nowMs?: number } = {}): Promise<LeaderboardRefresh> {
  const store = supabaseBoardCacheStore()
  const nowMs = opts.nowMs ?? Date.now()
  try {
    if (opts.maxAgeMs !== undefined) {
      const meta = await store.readMeta()
      const age = meta ? nowMs - Date.parse(meta.computed_at) : Number.POSITIVE_INFINITY
      if (age < opts.maxAgeMs) return { ok: false, reason: 'fresh', ageMs: age }
    }
    return await refreshBoardCache(store, () => loadBoardSource(), { nowMs, refreshId: randomUUID() })
  } catch (e: unknown) {
    if (isMissingBoardCacheTable(e instanceof Error ? e.message : undefined)) return { ok: false, reason: 'missing_table' }
    throw e
  }
}

/** Fire-and-forget form for routes that just graded something. */
export async function refreshLeaderboardCacheQuietly(label: string): Promise<void> {
  try {
    const result = await refreshLeaderboardCache()
    console.log(`[league-boards] refresh after ${label}: ${result.ok ? `${result.signatures} signatures` : result.reason}`)
  } catch (e: unknown) {
    console.log(`[league-boards] refresh after ${label} failed: ${e instanceof Error ? e.message : 'error'}`)
  }
}

/** Public read: the cache only, except a jurisdiction-narrowed scope no rebuild plans. */
export async function readLeaderboardBoards(filters: BoardFilters, visible: readonly string[] | null): Promise<BoardsResponse> {
  const nowMs = Date.now()
  try {
    return await readBoards(supabaseBoardCacheStore(), {
      filters,
      visible,
      nowMs,
      fill: async (categories, f) => computeEntry(await loadBoardSource(), categories, f, Date.now()),
    })
  } catch (e: unknown) {
    if (!isMissingBoardCacheTable(e instanceof Error ? e.message : undefined)) throw e
    return {
      kind: 'boards',
      signature: '',
      filters,
      pending: true,
      meta: { generatedAt: null, categories: [], minSample: WIN_RATE_MIN_SAMPLE, rounds: 0 },
      boards: emptyBoards(nowMs),
    }
  }
}

/** Admin preview including test rounds. Computed live, never written. */
export async function readLiveLeaderboardBoards(filters: BoardFilters): Promise<BoardsResponse> {
  return liveBoards(await loadBoardSource({ includeTest: true }), filters, Date.now())
}
