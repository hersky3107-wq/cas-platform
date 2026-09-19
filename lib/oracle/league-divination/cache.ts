/**
 * Persist the packed adapter result by roundId.
 *
 * Table: public.oracle_league_divination_cache (oracle-owned, keyed by
 * round_id). Not an oracle session kind. No credit write.
 *
 * First insert wins; a later viewer reads the winner so every viewer of
 * a round sees the identical rationale and ballot.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LeagueDivinationAdapterOutput } from './adapter-types'

export type LeagueDivinationCache = {
  get(roundId: string): Promise<LeagueDivinationAdapterOutput | null>
  /** Insert-if-absent. Returns the stored row (winner on a race). */
  putIfAbsent(
    roundId: string,
    firstViewedAt: string,
    output: LeagueDivinationAdapterOutput,
  ): Promise<LeagueDivinationAdapterOutput>
}

export function createMemoryLeagueDivinationCache(): LeagueDivinationCache {
  const rows = new Map<string, LeagueDivinationAdapterOutput>()
  return {
    async get(roundId) {
      return rows.get(roundId) ?? null
    },
    async putIfAbsent(roundId, _firstViewedAt, output) {
      const existing = rows.get(roundId)
      if (existing) return existing
      rows.set(roundId, output)
      return output
    },
  }
}

const TABLE = 'oracle_league_divination_cache'

export function createSupabaseLeagueDivinationCache(client: SupabaseClient): LeagueDivinationCache {
  return {
    async get(roundId) {
      const { data, error } = await client.from(TABLE).select('result').eq('round_id', roundId).maybeSingle()
      if (error) {
        console.warn('[league-divination] cache read:', error.message)
        return null
      }
      const row = data as { result: LeagueDivinationAdapterOutput } | null
      return row?.result ?? null
    },
    async putIfAbsent(roundId, firstViewedAt, output) {
      const { error } = await client.from(TABLE).insert({
        round_id: roundId,
        first_viewed_at: firstViewedAt,
        result: output,
      })
      if (error && error.code !== '23505') {
        console.warn('[league-divination] cache write:', error.message)
        return output
      }
      const { data } = await client.from(TABLE).select('result').eq('round_id', roundId).maybeSingle()
      const row = data as { result: LeagueDivinationAdapterOutput } | null
      return row?.result ?? output
    },
  }
}
