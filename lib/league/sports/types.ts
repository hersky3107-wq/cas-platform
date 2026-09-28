/**
 * Sports data pipeline types. Pure. No I/O.
 *
 * This layer feeds a future sports adapter — it does not compose rounds,
 * grade, or touch other categories.
 */

export const SPORTS_ODDS_TTL_MS = 5 * 60 * 60 * 1000
export const SPORTS_STATS_TTL_MS = 6 * 60 * 60 * 1000

/** >2h before kickoff → projected; <60min → confirmed. */
export const LINEUP_PROJECTED_BEFORE_MS = 2 * 60 * 60 * 1000
export const LINEUP_CONFIRMED_WITHIN_MS = 60 * 60 * 1000

export const SHARP_BOOK_KEYS = ['pinnacle', 'betfair_ex_eu', 'betfair_ex_uk', 'matchbook', 'smarkets'] as const
export type SharpBookKey = (typeof SHARP_BOOK_KEYS)[number]

export const LAUNCH_SPORTS_LEAGUES = [
  'soccer_epl',
  'soccer_uefa_champs_league',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_uefa_nations_league',
  'baseball_mlb',
  'basketball_nba',
  'mma_mixed_martial_arts',
] as const
export type SportsLeagueKey = (typeof LAUNCH_SPORTS_LEAGUES)[number]

export function isSportsLeagueKey(value: string): value is SportsLeagueKey {
  return (LAUNCH_SPORTS_LEAGUES as readonly string[]).includes(value)
}

export type LineupConfidence = 'projected' | 'pending' | 'confirmed'

export type DevigMethod = 'multiplicative' | 'shin'

export type OutcomeProbability = {
  name: string
  decimalOdds: number
  rawImplied: number
  probability: number
}

export type DevigResult = {
  method: DevigMethod
  bookKey: string
  bookTitle: string
  bookClass: 'sharp' | 'recreational'
  booksum: number
  overroundPct: number
  shinZ: number | null
  outcomes: OutcomeProbability[]
  limitation: string | null
}

export type OddsEvent = {
  id: string
  sportKey: string
  home: string
  away: string
  commenceTime: string
  bookmakers: OddsBookmaker[]
}

export type OddsBookmaker = {
  key: string
  title: string
  markets: Array<{
    key: string
    outcomes: Array<{ name: string; price: number }>
  }>
}

export type SportsTeams = { home: string; away: string }

export type LineupPlayer = { name: string; number: number | null; position: string | null }

export type TeamLineup = {
  team: string
  formation: string | null
  startXI: LineupPlayer[]
}

export type LineupSnapshot = {
  confidence: LineupConfidence
  immutable: boolean
  provider: 'api_sports'
  fixtureId: number | null
  fetchedAt: string
  teams: TeamLineup[]
  unavailable: string | null
}

export type FootballTeamStats = {
  team: string
  matches: number
  xg: number
  xga: number
  xgd: number
  xpts: number
}

export type MlbTeamStats = {
  team: string
  era: number | null
  fip: number | null
  whip: number | null
  xwoba: number | null
}

export type NbaTeamStats = {
  team: string
  netRating: number | null
  pace: number | null
  offRating: number | null
  defRating: number | null
}

export type FixtureStats = {
  sport: 'football' | 'baseball' | 'basketball'
  fetchedAt: string
  football?: { home: FootballTeamStats | null; away: FootballTeamStats | null; source: 'understat' }
  baseball?: { home: MlbTeamStats | null; away: MlbTeamStats | null; source: 'mlb_stats_api+savant' }
  basketball?: { home: NbaTeamStats | null; away: NbaTeamStats | null; source: 'nba_stats' }
  unavailable: string | null
}

export type SportsFixtureCacheRow = {
  fixture_id: string
  league: string
  teams: SportsTeams
  kickoff: string
  devigged_odds: DevigResult | null
  lineups: LineupSnapshot | null
  stats: FixtureStats | null
  fetched_at: string
  ttl: string
}
