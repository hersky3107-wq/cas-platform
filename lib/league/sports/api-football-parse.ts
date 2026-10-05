/**
 * API-Football (v3.football.api-sports.io) parsers. Pure. No I/O, no keys.
 */

import { extractResponseArray, parseFootballLineups, teamsMatch } from './lineup-logic'
import type { LineupSnapshot } from './types'

export const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io'

export type ApiFootballTeamRef = { id: number; name: string }

export type ApiFootballFixture = {
  fixtureId: number
  date: string
  timestamp: number | null
  statusShort: string
  statusLong: string
  leagueId: number
  leagueName: string
  leagueCountry: string
  season: number | null
  round: string | null
  home: ApiFootballTeamRef
  away: ApiFootballTeamRef
  goalsHome: number | null
  goalsAway: number | null
  fulltimeHome: number | null
  fulltimeAway: number | null
  extratimeHome: number | null
  extratimeAway: number | null
  penaltyHome: number | null
  penaltyAway: number | null
}

export type ApiFootballStandingRow = {
  rank: number
  team: ApiFootballTeamRef
  played: number
  win: number
  draw: number
  lose: number
  goalsFor: number
  goalsAgainst: number
  points: number
  form: string | null
  homePlayed: number | null
  homeWin: number | null
  homeDraw: number | null
  homeLose: number | null
  awayPlayed: number | null
  awayWin: number | null
  awayDraw: number | null
  awayLose: number | null
}

export type ApiFootballInjury = {
  player: string
  teamId: number
  teamName: string
  type: string | null
  reason: string | null
}

export type ApiFootballTeamStats = {
  team: ApiFootballTeamRef
  played: number | null
  goalsForAvg: number | null
  goalsAgainstAvg: number | null
  form: string | null
}

export type ApiFootballUsageHeaders = {
  requestsLimit: number | null
  requestsRemaining: number | null
}

const VOID_STATUS = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO'])
const FINISHED_STATUS = new Set(['FT', 'AET', 'PEN'])

export function isVoidFixtureStatus(short: string): boolean {
  return VOID_STATUS.has(short.toUpperCase())
}

export function isFinishedFixtureStatus(short: string): boolean {
  return FINISHED_STATUS.has(short.toUpperCase())
}

function num(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function obj(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

function teamRef(raw: unknown): ApiFootballTeamRef | null {
  const rec = obj(raw)
  const id = num(rec.id)
  const name = typeof rec.name === 'string' ? rec.name.trim() : ''
  if (id == null || !name) return null
  return { id, name }
}

function scorePair(raw: unknown): { home: number | null; away: number | null } {
  const rec = obj(raw)
  return { home: num(rec.home), away: num(rec.away) }
}

export function parseApiFootballErrors(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const errors = (raw as { errors?: unknown }).errors
  if (typeof errors === 'string' && errors.trim()) return errors
  if (Array.isArray(errors) && errors.length) return errors.map(String).join('; ')
  if (errors && typeof errors === 'object') {
    const values = Object.values(errors as Record<string, unknown>).filter((v) => typeof v === 'string') as string[]
    return values[0] ?? null
  }
  return null
}

export function parseApiFootballFixtures(raw: unknown): ApiFootballFixture[] {
  const out: ApiFootballFixture[] = []
  for (const row of extractResponseArray(raw)) {
    const parsed = parseOneFixture(row)
    if (parsed) out.push(parsed)
  }
  return out
}

export function parseOneFixture(row: unknown): ApiFootballFixture | null {
  if (!row || typeof row !== 'object') return null
  const rec = row as Record<string, unknown>
  const fixture = obj(rec.fixture)
  const league = obj(rec.league)
  const teams = obj(rec.teams)
  const goals = scorePair(rec.goals)
  const score = obj(rec.score)
  const ft = scorePair(score.fulltime)
  const et = scorePair(score.extratime)
  const pen = scorePair(score.penalty)
  const status = obj(fixture.status)
  const home = teamRef(teams.home)
  const away = teamRef(teams.away)
  const fixtureId = num(fixture.id)
  const leagueId = num(league.id)
  if (fixtureId == null || leagueId == null || !home || !away) return null
  const date =
    typeof fixture.date === 'string' && fixture.date
      ? fixture.date
      : typeof fixture.timestamp === 'number'
        ? new Date(fixture.timestamp * 1000).toISOString()
        : ''
  if (!date) return null
  return {
    fixtureId,
    date,
    timestamp: num(fixture.timestamp),
    statusShort: typeof status.short === 'string' ? status.short : '',
    statusLong: typeof status.long === 'string' ? status.long : '',
    leagueId,
    leagueName: typeof league.name === 'string' ? league.name : '',
    leagueCountry: typeof league.country === 'string' ? league.country : '',
    season: num(league.season),
    round: typeof league.round === 'string' ? league.round : null,
    home,
    away,
    goalsHome: goals.home,
    goalsAway: goals.away,
    fulltimeHome: ft.home,
    fulltimeAway: ft.away,
    extratimeHome: et.home,
    extratimeAway: et.away,
    penaltyHome: pen.home,
    penaltyAway: pen.away,
  }
}

export function parseApiFootballStandings(raw: unknown): ApiFootballStandingRow[] {
  const out: ApiFootballStandingRow[] = []
  for (const block of extractResponseArray(raw)) {
    const league = obj(obj(block).league)
    const tables = league.standings
    const groups = Array.isArray(tables) ? tables : []
    for (const group of groups) {
      if (!Array.isArray(group)) continue
      for (const row of group) {
        const parsed = parseStandingRow(row)
        if (parsed) out.push(parsed)
      }
    }
  }
  return out
}

function parseStandingRow(row: unknown): ApiFootballStandingRow | null {
  const rec = obj(row)
  const team = teamRef(rec.team)
  const all = obj(rec.all)
  const home = obj(rec.home)
  const away = obj(rec.away)
  const goals = obj(all.goals)
  const rank = num(rec.rank)
  if (!team || rank == null) return null
  return {
    rank,
    team,
    played: num(all.played) ?? 0,
    win: num(all.win) ?? 0,
    draw: num(all.draw) ?? 0,
    lose: num(all.lose) ?? 0,
    goalsFor: num(goals.for) ?? 0,
    goalsAgainst: num(goals.against) ?? 0,
    points: num(rec.points) ?? 0,
    form: typeof rec.form === 'string' ? rec.form : null,
    homePlayed: num(home.played),
    homeWin: num(home.win),
    homeDraw: num(home.draw),
    homeLose: num(home.lose),
    awayPlayed: num(away.played),
    awayWin: num(away.win),
    awayDraw: num(away.draw),
    awayLose: num(away.lose),
  }
}

export function standingForTeam(
  rows: readonly ApiFootballStandingRow[],
  team: { id?: number; name: string },
): ApiFootballStandingRow | null {
  if (typeof team.id === 'number') {
    const byId = rows.find((r) => r.team.id === team.id)
    if (byId) return byId
  }
  return rows.find((r) => teamsMatch(r.team.name, team.name)) ?? null
}

export function parseApiFootballInjuries(raw: unknown): ApiFootballInjury[] {
  const out: ApiFootballInjury[] = []
  for (const row of extractResponseArray(raw)) {
    const rec = obj(row)
    const player = obj(rec.player)
    const team = teamRef(rec.team)
    const name = typeof player.name === 'string' ? player.name.trim() : ''
    if (!team || !name) continue
    out.push({
      player: name,
      teamId: team.id,
      teamName: team.name,
      type: typeof rec.type === 'string' ? rec.type : typeof player.type === 'string' ? player.type : null,
      reason: typeof rec.reason === 'string' ? rec.reason : typeof player.reason === 'string' ? player.reason : null,
    })
  }
  return out
}

export function parseApiFootballTeamStatistics(raw: unknown, fallbackTeam: ApiFootballTeamRef): ApiFootballTeamStats | null {
  const listed = extractResponseArray(raw)
  const responseField = raw && typeof raw === 'object' ? (raw as { response?: unknown }).response : undefined
  const body = listed[0] && typeof listed[0] === 'object'
    ? obj(listed[0])
    : responseField && typeof responseField === 'object' && !Array.isArray(responseField)
      ? obj(responseField)
      : obj(raw)
  if (!Object.keys(body).length || body.errors) return null
  const team = teamRef(body.team) ?? fallbackTeam
  const fixtures = obj(body.fixtures)
  const played = obj(fixtures.played)
  const goals = obj(body.goals)
  const forBlock = obj(goals.for)
  const againstBlock = obj(goals.against)
  const forAvg = obj(forBlock.average)
  const againstAvg = obj(againstBlock.average)
  return {
    team,
    played: num(played.total),
    goalsForAvg: num(forAvg.total) ?? num(forBlock.total),
    goalsAgainstAvg: num(againstAvg.total) ?? num(againstBlock.total),
    form: typeof body.form === 'string' ? body.form : null,
  }
}

export function parseApiFootballTeams(raw: unknown): ApiFootballTeamRef[] {
  const out: ApiFootballTeamRef[] = []
  for (const row of extractResponseArray(raw)) {
    const rec = obj(row)
    const team = teamRef(rec.team) ?? teamRef(rec)
    if (team) out.push(team)
  }
  return out
}

export function lastFiveForm(form: string | null | undefined): string | null {
  if (!form) return null
  const cleaned = form.replace(/[^WDL]/gi, '').slice(-5)
  return cleaned || null
}

export type FootballScoreChoice = 'regular_time' | 'final'

export function propositionWantsRegularTime(proposition: string): boolean {
  return /regular time|90 minutes|90분|정규시간|stoppage/i.test(proposition)
}

export type FootballGradeDecision =
  | {
      kind: 'yes' | 'no'
      fixtureId: number
      status: string
      homeGoals: number
      awayGoals: number
      scoreLabel: string
      used: FootballScoreChoice
    }
  | { kind: 'void'; fixtureId: number; status: string; reason: string }
  | { kind: 'missing'; reason: string }

export function decideFootballMatchGrade(args: {
  fixture: ApiFootballFixture | null
  subjectIsHome: boolean
  scoreChoice: FootballScoreChoice
}): FootballGradeDecision {
  const fixture = args.fixture
  if (!fixture) return { kind: 'missing', reason: 'API-Football fixture not found' }
  if (isVoidFixtureStatus(fixture.statusShort)) {
    return {
      kind: 'void',
      fixtureId: fixture.fixtureId,
      status: fixture.statusShort || fixture.statusLong,
      reason: `fixture ${fixture.fixtureId} ${fixture.statusShort || fixture.statusLong}`,
    }
  }
  if (!isFinishedFixtureStatus(fixture.statusShort)) {
    return { kind: 'missing', reason: `fixture ${fixture.fixtureId} status ${fixture.statusShort || 'unknown'} not finished` }
  }

  let home: number | null
  let away: number | null
  let used: FootballScoreChoice = args.scoreChoice
  if (args.scoreChoice === 'regular_time') {
    home = fixture.fulltimeHome
    away = fixture.fulltimeAway
    if (home == null || away == null) {
      home = fixture.goalsHome
      away = fixture.goalsAway
    }
  } else if (fixture.statusShort === 'PEN') {
    const ftH = fixture.fulltimeHome ?? 0
    const ftA = fixture.fulltimeAway ?? 0
    const etH = fixture.extratimeHome ?? 0
    const etA = fixture.extratimeAway ?? 0
    home = ftH + etH + (fixture.penaltyHome ?? 0)
    away = ftA + etA + (fixture.penaltyAway ?? 0)
  } else if (fixture.statusShort === 'AET') {
    home = (fixture.fulltimeHome ?? 0) + (fixture.extratimeHome ?? 0)
    away = (fixture.fulltimeAway ?? 0) + (fixture.extratimeAway ?? 0)
  } else {
    home = fixture.goalsHome ?? fixture.fulltimeHome
    away = fixture.goalsAway ?? fixture.fulltimeAway
  }

  if (home == null || away == null) {
    return { kind: 'missing', reason: `fixture ${fixture.fixtureId} finished without a usable score` }
  }

  const subjectGoals = args.subjectIsHome ? home : away
  const oppGoals = args.subjectIsHome ? away : home
  const yes = subjectGoals > oppGoals
  return {
    kind: yes ? 'yes' : 'no',
    fixtureId: fixture.fixtureId,
    status: fixture.statusShort,
    homeGoals: home,
    awayGoals: away,
    scoreLabel: `${home}-${away}`,
    used,
  }
}

export function formatFootballGradeEvidence(decision: Exclude<FootballGradeDecision, { kind: 'missing' }>): string {
  if (decision.kind === 'void') {
    return `API-Football fixture ${decision.fixtureId} · ${decision.status} · void`
  }
  const dir = decision.kind === 'yes' ? 'up' : 'down'
  return `${dir} (API-Football fixture ${decision.fixtureId} · ${decision.status} · ${decision.scoreLabel} ${decision.used})`
}

export function parseApiFootballLineups(raw: unknown, kickoffIso: string, now: Date, fixtureId: number): LineupSnapshot {
  return parseFootballLineups(raw, kickoffIso, now, fixtureId)
}

export function usageFromHeaders(headers: Headers | { get(name: string): string | null }): ApiFootballUsageHeaders {
  const limit = Number(headers.get('x-ratelimit-requests-limit') ?? headers.get('X-RateLimit-Requests-Limit'))
  const remaining = Number(headers.get('x-ratelimit-requests-remaining') ?? headers.get('X-RateLimit-Requests-Remaining'))
  return {
    requestsLimit: Number.isFinite(limit) ? limit : null,
    requestsRemaining: Number.isFinite(remaining) ? remaining : null,
  }
}
