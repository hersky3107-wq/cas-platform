import 'server-only'

import { readFixtureCache, upsertFixtureCache } from './cache'
import { fetchJson, fetchText } from './http'
import { lookupByTeam, lookupFootballTeam, parseMlbTeamPitching, parseNbaAdvanced, parseSavantExpectedCsv, parseUnderstatLeague, understatSeasonYear } from './stats-parse'
import { SPORTS_STATS_TTL_MS, type FixtureStats, type MlbTeamStats, type SportsFixtureCacheRow } from './types'

const UNDERSTAT = 'https://understat.com/getLeagueData'
const MLB_TEAM_PITCHING =
  'https://statsapi.mlb.com/api/v1/teams/stats?season=2026&group=pitching&stats=season&sportIds=1'
const SAVANT_XWOBA =
  'https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=2026&min=50&csv=true'
const NBA_ADVANCED =
  'https://stats.nba.com/stats/leaguedashteamstats?MeasureType=Advanced&PerMode=PerGame&PlusMinus=N&PaceAdjust=N&Rank=N&LeagueID=00&Season=2025-26&SeasonType=Regular+Season&PORound=0&Month=0&OpponentTeamID=0&LastNGames=0&Period=0&ShotClockRange=&Conference=&DateFrom=&DateTo=&Division=&GameScope=&GameSegment=&Height=&ISTRound=&Location=&Outcome=&PlayerExperience=&PlayerPosition=&SeasonSegment=&StarterBench=&TeamID=0&TwoWay=0&VsConference=&VsDivision='

const BROWSER = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

function statsFresh(stats: FixtureStats | null, now: Date): boolean {
  if (!stats?.fetchedAt) return false
  const at = Date.parse(stats.fetchedAt)
  return Number.isFinite(at) && at + SPORTS_STATS_TTL_MS > now.getTime()
}

export async function fetchFixtureStats(
  fixtureId: string,
  now = new Date(),
  fetchImpl: typeof fetch = fetch
): Promise<FixtureStats> {
  const row = await readFixtureCache(fixtureId)
  if (!row) {
    return { sport: 'football', fetchedAt: now.toISOString(), unavailable: 'cache miss — fetch odds slate first' }
  }
  if (statsFresh(row.stats, now)) return row.stats as FixtureStats

  const sport = sportOf(row.league)
  if (!sport) {
    return { sport: 'football', fetchedAt: now.toISOString(), unavailable: `no stats table for ${row.league}` }
  }
  const stats =
    sport === 'football'
      ? await footballStats(row, now, fetchImpl)
      : sport === 'baseball'
        ? await baseballStats(row, now, fetchImpl)
        : await basketballStats(row, now, fetchImpl)

  await upsertFixtureCache({
    ...row,
    stats,
    fetched_at: now.toISOString(),
  })
  return stats
}

function sportOf(league: string): FixtureStats['sport'] | null {
  if (league === 'mma_mixed_martial_arts' || league === 'americanfootball_nfl' || league === 'icehockey_nhl') {
    return null
  }
  if (league === 'baseball_mlb') return 'baseball'
  if (league === 'basketball_nba') return 'basketball'
  return 'football'
}

function understatLeagueOf(league: string): string | null {
  if (league === 'soccer_epl') return 'EPL'
  if (league === 'soccer_spain_la_liga') return 'La_liga'
  if (league === 'soccer_uefa_champs_league') return 'CL'
  if (league === 'soccer_italy_serie_a') return 'Serie_A'
  return null
}

async function footballStats(row: SportsFixtureCacheRow, now: Date, fetchImpl: typeof fetch): Promise<FixtureStats> {
  const year = understatSeasonYear(row.kickoff, now)
  const understatLeague = understatLeagueOf(row.league)
  if (!understatLeague) {
    return { sport: 'football', fetchedAt: now.toISOString(), unavailable: `no Understat table for ${row.league}` }
  }
  const res = await fetchJson(
    `${UNDERSTAT}/${understatLeague}/${year}`,
    { headers: { ...BROWSER, 'x-requested-with': 'XMLHttpRequest', Referer: `https://understat.com/league/${understatLeague}/${year}` } },
    fetchImpl
  )
  if (!res.ok) {
    return { sport: 'football', fetchedAt: now.toISOString(), unavailable: `Understat: ${res.error}` }
  }
  const table = parseUnderstatLeague(res.json)
  return {
    sport: 'football',
    fetchedAt: now.toISOString(),
    football: {
      home: lookupFootballTeam(table, row.teams.home),
      away: lookupFootballTeam(table, row.teams.away),
      source: 'understat',
    },
    unavailable: table.length === 0 ? 'Understat returned no teams' : null,
  }
}

async function baseballStats(row: SportsFixtureCacheRow, now: Date, fetchImpl: typeof fetch): Promise<FixtureStats> {
  const pitching = await fetchJson(MLB_TEAM_PITCHING, { headers: BROWSER }, fetchImpl)
  if (!pitching.ok) {
    return { sport: 'baseball', fetchedAt: now.toISOString(), unavailable: `MLB Stats API: ${pitching.error}` }
  }
  const teams = parseMlbTeamPitching(pitching.json)
  const savant = await fetchText(SAVANT_XWOBA, { headers: { ...BROWSER, Accept: 'text/csv,text/plain,*/*' } }, fetchImpl)
  const xwobaLeague = savant.ok ? paWeightedXwoba(parseSavantExpectedCsv(savant.text)) : null
  const attach = (name: string): MlbTeamStats | null => {
    const t = lookupByTeam(teams, name)
    if (!t) return null
    return { ...t, xwoba: t.xwoba ?? xwobaLeague }
  }
  return {
    sport: 'baseball',
    fetchedAt: now.toISOString(),
    baseball: { home: attach(row.teams.home), away: attach(row.teams.away), source: 'mlb_stats_api+savant' },
    unavailable: teams.length === 0 ? 'MLB Stats API returned no team pitching rows' : null,
  }
}

function paWeightedXwoba(rows: Array<{ pa: number; xwoba: number }>): number | null {
  let pa = 0
  let acc = 0
  for (const r of rows) {
    if (r.pa <= 0 || !Number.isFinite(r.xwoba)) continue
    pa += r.pa
    acc += r.xwoba * r.pa
  }
  return pa > 0 ? Math.round((acc / pa) * 1000) / 1000 : null
}

async function basketballStats(row: SportsFixtureCacheRow, now: Date, fetchImpl: typeof fetch): Promise<FixtureStats> {
  const res = await fetchJson(
    NBA_ADVANCED,
    {
      headers: {
        ...BROWSER,
        Referer: 'https://www.nba.com/',
        Origin: 'https://www.nba.com',
        Accept: 'application/json, text/plain, */*',
        'x-nba-stats-origin': 'stats',
        'x-nba-stats-token': 'true',
      },
    },
    fetchImpl
  )
  if (!res.ok) {
    return { sport: 'basketball', fetchedAt: now.toISOString(), unavailable: `NBA stats: ${res.error}` }
  }
  const table = parseNbaAdvanced(res.json)
  return {
    sport: 'basketball',
    fetchedAt: now.toISOString(),
    basketball: {
      home: lookupByTeam(table, row.teams.home),
      away: lookupByTeam(table, row.teams.away),
      source: 'nba_stats',
    },
    unavailable: table.length === 0 ? 'NBA stats returned no teams' : null,
  }
}

