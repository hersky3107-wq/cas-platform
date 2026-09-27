import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import type { SportsFixtureCacheRow } from './types'

const TABLE = 'sports_fixture_cache'

export async function readFixtureCache(fixtureId: string): Promise<SportsFixtureCacheRow | null> {
  const { data, error } = await supabaseAdmin.from(TABLE).select('*').eq('fixture_id', fixtureId).maybeSingle()
  if (error) throw new Error(`sports_fixture_cache read: ${error.message}`)
  return data ? asRow(data as Record<string, unknown>) : null
}

export async function listLeagueCache(league: string): Promise<SportsFixtureCacheRow[]> {
  const { data, error } = await supabaseAdmin.from(TABLE).select('*').eq('league', league).order('kickoff', { ascending: true })
  if (error) throw new Error(`sports_fixture_cache list: ${error.message}`)
  return (data ?? []).map((row) => asRow(row as Record<string, unknown>))
}

export async function upsertFixtureCache(row: SportsFixtureCacheRow): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLE).upsert(
    {
      fixture_id: row.fixture_id,
      league: row.league,
      teams: row.teams,
      kickoff: row.kickoff,
      devigged_odds: row.devigged_odds,
      lineups: row.lineups,
      stats: row.stats,
      fetched_at: row.fetched_at,
      ttl: row.ttl,
    },
    { onConflict: 'fixture_id' }
  )
  if (error) throw new Error(`sports_fixture_cache upsert: ${error.message}`)
}

export async function upsertFixtureCacheMany(rows: SportsFixtureCacheRow[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabaseAdmin.from(TABLE).upsert(
    rows.map((row) => ({
      fixture_id: row.fixture_id,
      league: row.league,
      teams: row.teams,
      kickoff: row.kickoff,
      devigged_odds: row.devigged_odds,
      lineups: row.lineups,
      stats: row.stats,
      fetched_at: row.fetched_at,
      ttl: row.ttl,
    })),
    { onConflict: 'fixture_id' }
  )
  if (error) throw new Error(`sports_fixture_cache bulk upsert: ${error.message}`)
}

function asRow(row: Record<string, unknown>): SportsFixtureCacheRow {
  const teams = row.teams && typeof row.teams === 'object' ? (row.teams as { home?: unknown; away?: unknown }) : {}
  return {
    fixture_id: String(row.fixture_id ?? ''),
    league: String(row.league ?? ''),
    teams: { home: String(teams.home ?? ''), away: String(teams.away ?? '') },
    kickoff: String(row.kickoff ?? ''),
    devigged_odds: (row.devigged_odds as SportsFixtureCacheRow['devigged_odds']) ?? null,
    lineups: (row.lineups as SportsFixtureCacheRow['lineups']) ?? null,
    stats: (row.stats as SportsFixtureCacheRow['stats']) ?? null,
    fetched_at: String(row.fetched_at ?? ''),
    ttl: String(row.ttl ?? ''),
  }
}
