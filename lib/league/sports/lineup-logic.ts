/**
 * Lineup confidence + API-Sports payload parsing. Pure.
 *
 * Confidence (from kickoff, not from the feed):
 *   projected  — more than 2h before kickoff
 *   pending    — 60min–2h (lineups often leak then; still not official)
 *   confirmed  — within 60min of kickoff, or kickoff already passed
 *
 * A confirmed 11-a-side snapshot is immutable regardless of clock: once we
 * have it, we never refetch.
 *
 * Free-tier window (probed 2026-09-27): API-Sports football date queries
 * only accept yesterday/today/tomorrow. Current-season league+season is
 * blocked ("try from 2022 to 2024"). Lineups-by-fixture-id still work for
 * those historical seasons. `last=` is blocked.
 */

import {
  LINEUP_CONFIRMED_WITHIN_MS,
  LINEUP_PROJECTED_BEFORE_MS,
  type LineupConfidence,
  type LineupPlayer,
  type LineupSnapshot,
  type TeamLineup,
} from './types'

export function lineupConfidence(kickoffIso: string, now: Date): LineupConfidence {
  const kickoff = Date.parse(kickoffIso)
  if (!Number.isFinite(kickoff)) return 'projected'
  const delta = kickoff - now.getTime()
  if (delta <= LINEUP_CONFIRMED_WITHIN_MS) return 'confirmed'
  if (delta > LINEUP_PROJECTED_BEFORE_MS) return 'projected'
  return 'pending'
}

export function utcDateStamp(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** API-Sports free date filter is ±1 UTC calendar day from "today". */
export function inApiSportsFreeDateWindow(kickoffIso: string, now: Date): boolean {
  const kickoff = Date.parse(kickoffIso)
  if (!Number.isFinite(kickoff)) return false
  const k = Date.parse(`${utcDateStamp(new Date(kickoff))}T00:00:00.000Z`)
  const n = Date.parse(`${utcDateStamp(now)}T00:00:00.000Z`)
  const day = 24 * 60 * 60 * 1000
  return Math.abs(k - n) <= day
}

export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fc|afc|cfc|a\.?f\.?c\.?)\b/g, '')
    .replace(/\b(and|&)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bhotspur\b/g, '')
    .replace(/\bhove albion\b/g, '')
    .replace(/\btown\b/g, '')
    .replace(/\bunited\b/g, 'utd')
    .trim()
    .replace(/\s+/g, ' ')
}

export function teamsMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a)
  const nb = normalizeTeamName(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

export function parseFootballLineups(raw: unknown, kickoffIso: string, now: Date, fixtureId: number | null): LineupSnapshot {
  const confidence = lineupConfidence(kickoffIso, now)
  const list = extractResponseArray(raw)
  const teams: TeamLineup[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const teamObj = rec.team && typeof rec.team === 'object' ? (rec.team as Record<string, unknown>) : {}
    const team = typeof teamObj.name === 'string' ? teamObj.name : ''
    const formation = typeof rec.formation === 'string' ? rec.formation : null
    const startXI = parseStartXi(rec.startXI)
    if (team) teams.push({ team, formation, startXI })
  }
  const hasConfirmedXi = teams.length >= 2 && teams.every((t) => t.startXI.length === 11)
  const immutable = hasConfirmedXi && (confidence === 'confirmed' || kickoffAlreadyPassed(kickoffIso, now))
  return {
    confidence: hasConfirmedXi && (confidence === 'confirmed' || kickoffAlreadyPassed(kickoffIso, now))
      ? 'confirmed'
      : confidence,
    immutable,
    provider: 'api_sports',
    fixtureId,
    fetchedAt: now.toISOString(),
    teams,
    unavailable: teams.length === 0 ? 'API-Sports returned no lineup rows' : null,
  }
}

function kickoffAlreadyPassed(kickoffIso: string, now: Date): boolean {
  const kickoff = Date.parse(kickoffIso)
  return Number.isFinite(kickoff) && kickoff <= now.getTime()
}

function parseStartXi(raw: unknown): LineupPlayer[] {
  if (!Array.isArray(raw)) return []
  const players: LineupPlayer[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const player = (row as { player?: unknown }).player
    if (!player || typeof player !== 'object') continue
    const p = player as Record<string, unknown>
    const name = typeof p.name === 'string' ? p.name : ''
    if (!name) continue
    players.push({
      name,
      number: typeof p.number === 'number' ? p.number : null,
      position: typeof p.pos === 'string' ? p.pos : typeof p.position === 'string' ? p.position : null,
    })
  }
  return players
}

export function extractResponseArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object' && Array.isArray((raw as { response?: unknown }).response)) {
    return (raw as { response: unknown[] }).response
  }
  return []
}

export function matchFixtureIdFromDateList(args: {
  payload: unknown
  home: string
  away: string
  leagueId?: number
}): number | null {
  const rows = extractResponseArray(args.payload)
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const league = rec.league && typeof rec.league === 'object' ? (rec.league as Record<string, unknown>) : {}
    if (typeof args.leagueId === 'number' && league.id !== args.leagueId) continue
    const teams = rec.teams && typeof rec.teams === 'object' ? (rec.teams as Record<string, unknown>) : {}
    const homeObj = teams.home && typeof teams.home === 'object' ? (teams.home as Record<string, unknown>) : {}
    const awayObj = teams.away && typeof teams.away === 'object' ? (teams.away as Record<string, unknown>) : {}
    const home = typeof homeObj.name === 'string' ? homeObj.name : ''
    const away = typeof awayObj.name === 'string' ? awayObj.name : ''
    if (teamsMatch(home, args.home) && teamsMatch(away, args.away)) {
      const fixture = rec.fixture && typeof rec.fixture === 'object' ? (rec.fixture as Record<string, unknown>) : rec
      const id = typeof fixture.id === 'number' ? fixture.id : Number(fixture.id)
      return Number.isFinite(id) ? id : null
    }
  }
  return null
}

export function shouldSkipLineupFetch(existing: LineupSnapshot | null): boolean {
  return Boolean(existing?.immutable)
}

export function apiSportsPlanError(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const errors = (raw as { errors?: unknown }).errors
  if (typeof errors === 'string' && errors.trim()) return errors
  if (errors && typeof errors === 'object' && !Array.isArray(errors)) {
    const values = Object.values(errors as Record<string, unknown>).filter((v) => typeof v === 'string') as string[]
    return values[0] ?? null
  }
  return null
}
