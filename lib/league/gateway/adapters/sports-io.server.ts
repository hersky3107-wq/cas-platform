import 'server-only'

import { getResearchPacket } from '../../research'
import { fetchOddsSlate, fetchFixtureStats, listLeagueCache, readFixtureCache } from '../../sports/server'
import { LAUNCH_SPORTS_LEAGUES, isSportsLeagueKey } from '../../sports/types'
import type { SportsPacketIo } from './sports-packet'

async function listUpcomingFixtures(now = new Date()) {
  await Promise.all(LAUNCH_SPORTS_LEAGUES.map((league) => fetchOddsSlate(league, now).catch(() => null)))
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

export const LIVE_SPORTS_IO: SportsPacketIo = {
  listUpcomingFixtures,
  readFixture: (eventId) => readFixtureCache(eventId),
  fetchFixtureStats: (eventId) => fetchFixtureStats(eventId),
  getResearchPacket: ({ round, budgetRemainingUsd, tier, forcedQueries }) =>
    getResearchPacket({ round, budgetRemainingUsd, tier, forcedQueries }),
}
