import 'server-only'

import { readFixtureCache, upsertFixtureCache } from './cache'
import { fetchJson } from './http'
import {
  apiSportsPlanError,
  inApiSportsFreeDateWindow,
  lineupConfidence,
  matchFixtureIdFromDateList,
  parseFootballLineups,
  shouldSkipLineupFetch,
  utcDateStamp,
} from './lineup-logic'
import type { LineupSnapshot, SportsFixtureCacheRow } from './types'

const FOOTBALL = 'https://v3.football.api-sports.io'
const EPL_LEAGUE_ID = 39

function apiSportsHeaders(): HeadersInit {
  const key = process.env.API_SPORTS_KEY?.trim() ?? ''
  return { 'x-apisports-key': key }
}

export type LineupFetchResult = {
  snapshot: LineupSnapshot
  skipped: boolean
  spentRequest: boolean
}

/**
 * Confirmed lineups are cached forever. Upcoming fixtures only hit API-Sports
 * inside the free ±1-day date window (probed). Historical 2022–2024 seasons
 * can be resolved by fixture id without that window.
 */
export async function fetchFixtureLineups(
  fixtureId: string,
  now = new Date(),
  fetchImpl: typeof fetch = fetch
): Promise<LineupFetchResult> {
  const row = await readFixtureCache(fixtureId)
  if (!row) {
    return {
      snapshot: emptySnapshot(now, 'cache miss — fetch odds slate first', 'projected'),
      skipped: true,
      spentRequest: false,
    }
  }
  if (shouldSkipLineupFetch(row.lineups)) {
    return { snapshot: row.lineups!, skipped: true, spentRequest: false }
  }

  const key = process.env.API_SPORTS_KEY?.trim()
  if (!key) {
    return { snapshot: emptySnapshot(now, 'API_SPORTS_KEY is not set', row.kickoff), skipped: true, spentRequest: false }
  }

  let sportsId = row.lineups?.fixtureId ?? null

  if (sportsId == null) {
    if (!inApiSportsFreeDateWindow(row.kickoff, now)) {
      const snapshot = emptySnapshot(
        now,
        `API-Sports free plan date window is ±1 day (kickoff ${row.kickoff.slice(0, 10)}). Historical seasons 2022–2024 remain queryable by fixture id.`,
        row.kickoff
      )
      await persistLineup(row, snapshot)
      return { snapshot, skipped: true, spentRequest: false }
    }
    const date = utcDateStamp(new Date(row.kickoff))
    const listed = await fetchJson(`${FOOTBALL}/fixtures?date=${date}`, { headers: apiSportsHeaders() }, fetchImpl)
    if (!listed.ok) {
      const snapshot = emptySnapshot(now, listed.error, row.kickoff)
      await persistLineup(row, snapshot)
      return { snapshot, skipped: false, spentRequest: true }
    }
    const plan = apiSportsPlanError(listed.json)
    if (plan) {
      const snapshot = emptySnapshot(now, plan, row.kickoff)
      await persistLineup(row, snapshot)
      return { snapshot, skipped: false, spentRequest: true }
    }
    sportsId = matchFixtureIdFromDateList({
      payload: listed.json,
      home: row.teams.home,
      away: row.teams.away,
      leagueId: row.league === 'soccer_epl' ? EPL_LEAGUE_ID : undefined,
    })
    if (sportsId == null) {
      const snapshot = emptySnapshot(
        now,
        `no API-Sports fixture matched ${row.teams.home} vs ${row.teams.away} on ${date}`,
        row.kickoff
      )
      await persistLineup(row, snapshot)
      return { snapshot, skipped: false, spentRequest: true }
    }
  }

  const lineupRes = await fetchJson(
    `${FOOTBALL}/fixtures/lineups?fixture=${sportsId}`,
    { headers: apiSportsHeaders() },
    fetchImpl
  )
  if (!lineupRes.ok) {
    const snapshot = emptySnapshot(now, lineupRes.error, row.kickoff)
    snapshot.fixtureId = sportsId
    await persistLineup(row, snapshot)
    return { snapshot, skipped: false, spentRequest: true }
  }
  const snapshot = parseFootballLineups(lineupRes.json, row.kickoff, now, sportsId)
  await persistLineup(row, snapshot)
  return { snapshot, skipped: false, spentRequest: true }
}

function emptySnapshot(now: Date, reason: string, kickoffOrProjected: string): LineupSnapshot {
  const confidence = kickoffOrProjected === 'projected' ? 'projected' : lineupConfidence(kickoffOrProjected, now)
  return {
    confidence,
    immutable: false,
    provider: 'api_sports',
    fixtureId: null,
    fetchedAt: now.toISOString(),
    teams: [],
    unavailable: reason,
  }
}

async function persistLineup(row: SportsFixtureCacheRow, snapshot: LineupSnapshot): Promise<void> {
  await upsertFixtureCache({ ...row, lineups: snapshot, fetched_at: snapshot.fetchedAt })
}
