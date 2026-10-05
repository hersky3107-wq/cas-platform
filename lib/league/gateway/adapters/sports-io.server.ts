import 'server-only'

import { getResearchPacket } from '../../research'
import { loadFootballMatchFacts, resolveFixtureIdForParts, searchFootballFixtures } from '../../sports/api-football'
import { fetchOddsEvents, fetchFixtureStats, listLeagueCache, readFixtureCache } from '../../sports/server'
import { LAUNCH_SPORTS_LEAGUES, isSportsLeagueKey } from '../../sports/types'
import type { SportsPacketIo } from './sports-packet'

async function listUpcomingFixtures(now = new Date()) {
  await Promise.all(LAUNCH_SPORTS_LEAGUES.map((league) => fetchOddsEvents(league, now).catch(() => null)))
  const rows = (
    await Promise.all(LAUNCH_SPORTS_LEAGUES.map((league) => listLeagueCache(league).catch(() => [])))
  ).flat()
  return rows
    .filter((row) => isSportsLeagueKey(row.league) && Date.parse(row.kickoff) > now.getTime() - 3 * 60 * 60 * 1000)
    .map((row) => ({
      fixture_id: row.fixture_id,
      league: row.league,
      home: row.teams.home,
      away: row.teams.away,
      kickoff: row.kickoff,
    }))
}

async function fetchFootballFacts(
  eventId: string,
  hint?: { home: string; away: string; kickoffIso: string },
) {
  const id = await resolveFixtureIdForParts(eventId, hint)
  if (id == null) return null
  return loadFootballMatchFacts(id)
}

export const LIVE_SPORTS_IO: SportsPacketIo = {
  listUpcomingFixtures,
  searchFootballFixtures,
  readFixture: (eventId) => readFixtureCache(eventId),
  fetchFixtureStats: (eventId) => fetchFixtureStats(eventId),
  fetchFootballFacts,
  getResearchPacket: ({ round, budgetRemainingUsd, tier, forcedQueries }) =>
    getResearchPacket({ round, budgetRemainingUsd, tier, forcedQueries }),
}
