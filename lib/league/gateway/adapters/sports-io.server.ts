import 'server-only'

import { getResearchPacket } from '../../research'
import { loadFootballMatchFacts, resolveFixtureIdForParts, searchFootballFixtures } from '../../sports/api-football'
import { fetchOddsEvents, fetchFixtureStats, listLeagueCache, readFixtureCache } from '../../sports/server'
import { gamesFromSearchText, parseDomesticBaseballIntent } from '../../sports/domestic-baseball'
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

async function searchDomesticBaseball(query: string, now: Date) {
  const intent = parseDomesticBaseballIntent(query)
  if (!intent) return []
  const packet = await getResearchPacket({
    round: {
      instrument: 'MATCH:baseball_kbo:lookup',
      category: 'sports',
      proposition_text: query,
      horizon: '1d',
      resolution_rule: 'final result including extra innings',
      resolves_at: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    },
    budgetRemainingUsd: 0.05,
    forcedQueries: [
      { q: query, lang: 'ko' },
      { q: `${query} 일정 경기장`, lang: 'ko' },
    ],
  }).catch(() => null)
  const text = (packet?.findings ?? []).map((finding) => finding.summary).join('\n')
  return gamesFromSearchText(text, now, intent)
}

export const LIVE_SPORTS_IO: SportsPacketIo = {
  listUpcomingFixtures,
  searchDomesticBaseball,
  searchFootballFixtures,
  readFixture: (eventId) => readFixtureCache(eventId),
  fetchFixtureStats: (eventId) => fetchFixtureStats(eventId),
  fetchFootballFacts,
  getResearchPacket: ({ round, budgetRemainingUsd, tier, forcedQueries }) =>
    getResearchPacket({ round, budgetRemainingUsd, tier, forcedQueries }),
}
