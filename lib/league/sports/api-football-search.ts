/**
 * Pure football search helpers: team ranking, next-fixture pick, season/path.
 * I/O lives in api-football.ts.
 */

import { FOOTBALL_SEARCH_WINDOW_MS, isRefusedFootballCompetition } from './api-football-leagues'
import { teamsMatch } from './lineup-logic'
import type { ApiFootballFixture, ApiFootballTeamRef } from './api-football-parse'

export const FOOTBALL_NEXT_COUNT = 5
export const FOOTBALL_SEARCH_TIMEZONE = 'Asia/Seoul'

export type FootballSearchReason =
  | 'ok'
  | 'api_failure'
  | 'team_not_found'
  | 'no_upcoming_fixture'
  | 'non_public_fixture'

const DEMOTE_NAME = /citizen|university|women|ladies|\bw\b|u-?1[89]\b|u-?20\b|u-?21\b|u-?23\b|reserves?|academy/i
const FINISHED_OR_VOID = /^(FT|AET|PEN|PST|CANC|ABD|AWD|WO)$/i

export function footballSearchSeason(now: Date): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear()
}

export function isApiFootballSearchQuery(q: string): boolean {
  const trimmed = q.trim()
  return trimmed.length >= 2 && /^[a-zA-Z0-9 .'-]+$/.test(trimmed)
}

function ymdUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function teamsSearchPath(q: string): string {
  return `/teams?search=${encodeURIComponent(q)}`
}

export function teamUpcomingPath(teamId: number, now: Date): string {
  return `/fixtures?team=${teamId}&next=${FOOTBALL_NEXT_COUNT}&season=${footballSearchSeason(now)}&timezone=${FOOTBALL_SEARCH_TIMEZONE}`
}

export function teamUpcomingFallbackPath(teamId: number, now: Date): string {
  const from = ymdUtc(now.getTime())
  const to = ymdUtc(now.getTime() + FOOTBALL_SEARCH_WINDOW_MS)
  return `/fixtures?team=${teamId}&season=${footballSearchSeason(now)}&from=${from}&to=${to}&timezone=${FOOTBALL_SEARCH_TIMEZONE}`
}

export function headToHeadUpcomingPath(homeId: number, awayId: number, now: Date): string {
  return `/fixtures/headtohead?h2h=${homeId}-${awayId}&next=${FOOTBALL_NEXT_COUNT}&season=${footballSearchSeason(now)}&timezone=${FOOTBALL_SEARCH_TIMEZONE}`
}

export function broadenTeamSearchQueries(q: string): string[] {
  const trimmed = q.trim()
  if (!trimmed) return []
  const out = [trimmed]
  const first = trimmed.split(/\s+/)[0] ?? ''
  if (first.length >= 3 && first.toLowerCase() !== trimmed.toLowerCase()) out.push(first)
  return out
}

export function rankTeamCandidates(teams: readonly ApiFootballTeamRef[], query: string): ApiFootballTeamRef[] {
  return [...teams].sort((a, b) => scoreTeam(b, query) - scoreTeam(a, query))
}

export function pickPreferredTeam(teams: readonly ApiFootballTeamRef[], query: string): ApiFootballTeamRef | null {
  return rankTeamCandidates(teams, query)[0] ?? null
}

function scoreTeam(team: ApiFootballTeamRef, query: string): number {
  const name = team.name.toLowerCase()
  const q = query.toLowerCase()
  let score = 0
  if (name === q) score += 100
  if (teamsMatch(team.name, query)) score += 50
  if (name.includes(q)) score += 20
  if (/\bhd\b|hyundai/.test(name)) score += 15
  if (DEMOTE_NAME.test(name)) score -= 80
  return score
}

export function isScheduledFixture(f: ApiFootballFixture, now: Date): boolean {
  if (FINISHED_OR_VOID.test(f.statusShort)) return false
  const t = Date.parse(f.date)
  return Number.isFinite(t) && t > now.getTime() - 3 * 60 * 60 * 1000 && t <= now.getTime() + FOOTBALL_SEARCH_WINDOW_MS
}

export function selectNextScheduledFixture(
  fixtures: readonly ApiFootballFixture[],
  now: Date,
  otherTeamId?: number,
): ApiFootballFixture | null {
  const rows = fixtures
    .filter((f) => isScheduledFixture(f, now) && !isRefusedFootballCompetition(f.leagueId, f.leagueName))
    .filter((f) => (otherTeamId == null ? true : f.home.id === otherTeamId || f.away.id === otherTeamId))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  return rows[0] ?? null
}

export function fixturesMatchingBothTeams(
  fixtures: readonly ApiFootballFixture[],
  a: number,
  b: number,
): ApiFootballFixture[] {
  return fixtures.filter(
    (f) =>
      (f.home.id === a && f.away.id === b) ||
      (f.home.id === b && f.away.id === a),
  )
}
