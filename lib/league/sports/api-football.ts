import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { extractFootballLeagueHits, footballTeamSearchQueries, resolveFootballSearchName } from './api-football-aliases'
import {
  encodeApiFootballEventId,
  FOOTBALL_SEARCH_WINDOW_MS,
  footballLeagueKeyFromApiId,
  isRefusedFootballCompetition,
  parseApiFootballEventId,
} from './api-football-leagues'
import {
  broadenTeamSearchQueries,
  fixturesMatchingBothTeams,
  headToHeadUpcomingPath,
  isApiFootballSearchQuery,
  rankTeamCandidates,
  selectNextScheduledFixture,
  teamUpcomingFallbackPath,
  teamUpcomingPath,
  teamsSearchPath,
  type FootballSearchReason,
} from './api-football-search'
import {
  API_FOOTBALL_BASE,
  parseApiFootballErrors,
  parseApiFootballFixtures,
  parseApiFootballInjuries,
  parseApiFootballStandings,
  parseApiFootballTeamStatistics,
  parseApiFootballTeams,
  parseApiFootballLineups,
  type ApiFootballFixture,
  type ApiFootballInjury,
  type ApiFootballStandingRow,
  type ApiFootballTeamRef,
  type ApiFootballTeamStats,
} from './api-football-parse'
import { apiFootballDevig, apiFootballOddsPath } from './api-football-odds'
import { footballFactsFromParts, type FootballMatchFacts } from './api-football-packet'
import { fetchJson } from './http'
import { teamsMatch } from './lineup-logic'
import type { DevigResult, SportsTeams } from './types'

export type FootballSearchFixture = {
  fixture_id: string
  league: string
  home: string
  away: string
  kickoff: string
}

export type FootballSearchResult = {
  fixtures: FootballSearchFixture[]
  reason: FootballSearchReason
}

const CACHE_TABLE = 'api_football_http_cache'
const USAGE_TABLE = 'api_football_usage'
const MIN_INTERVAL_MS = 220
const MAX_PER_MINUTE = 300
const MAX_RETRIES = 4

type CacheRow = { payload: unknown; fetched_at: string; ttl: string }

const memoryCache = new Map<string, CacheRow>()
const minuteStamps: number[] = []
let lastRequestAt = 0
let queue: Promise<void> = Promise.resolve()

function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function apiHeaders(): HeadersInit {
  const key = process.env.API_SPORTS_KEY?.trim() ?? ''
  return { 'x-apisports-key': key }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForSlot(): Promise<void> {
  const run = queue.then(async () => {
    const now = Date.now()
    while (minuteStamps.length && minuteStamps[0]! <= now - 60_000) minuteStamps.shift()
    if (minuteStamps.length >= MAX_PER_MINUTE) {
      await sleep(minuteStamps[0]! + 60_000 - now + 20)
    }
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequestAt = Date.now()
    minuteStamps.push(lastRequestAt)
  })
  queue = run.then(() => undefined).catch(() => undefined)
  await run
}

async function bumpUsage(day = utcDay()): Promise<number> {
  try {
    const { data } = await supabaseAdmin.from(USAGE_TABLE).select('request_count').eq('day', day).maybeSingle()
    const next = Number(data?.request_count ?? 0) + 1
    const { error } = await supabaseAdmin.from(USAGE_TABLE).upsert({ day, request_count: next }, { onConflict: 'day' })
    if (error) {
      console.info(`[api-football] requests day=${day} count=${next} (usage table unavailable)`)
      return next
    }
    console.info(`[api-football] requests day=${day} count=${next}`)
    return next
  } catch {
    console.info(`[api-football] requests day=${day} (usage log skipped)`)
    return 0
  }
}

export async function readApiFootballUsageToday(now = new Date()): Promise<{ day: string; requestCount: number }> {
  const day = utcDay(now)
  try {
    const { data } = await supabaseAdmin.from(USAGE_TABLE).select('request_count').eq('day', day).maybeSingle()
    return { day, requestCount: Number(data?.request_count ?? 0) }
  } catch {
    return { day, requestCount: 0 }
  }
}

function cacheFresh(row: CacheRow, now: Date): boolean {
  return Date.parse(row.ttl) > now.getTime()
}

async function readHttpCache(key: string, now: Date): Promise<unknown | null> {
  const mem = memoryCache.get(key)
  if (mem && cacheFresh(mem, now)) return mem.payload
  try {
    const { data } = await supabaseAdmin.from(CACHE_TABLE).select('payload, fetched_at, ttl').eq('cache_key', key).maybeSingle()
    if (!data) return null
    const row = data as CacheRow
    if (!cacheFresh(row, now)) return null
    memoryCache.set(key, row)
    return row.payload
  } catch {
    return null
  }
}

async function writeHttpCache(key: string, payload: unknown, ttlMs: number, now: Date): Promise<void> {
  const row: CacheRow = {
    payload,
    fetched_at: now.toISOString(),
    ttl: new Date(now.getTime() + ttlMs).toISOString(),
  }
  memoryCache.set(key, row)
  try {
    await supabaseAdmin.from(CACHE_TABLE).upsert(
      { cache_key: key, payload, fetched_at: row.fetched_at, ttl: row.ttl },
      { onConflict: 'cache_key' },
    )
  } catch {
    // in-process memo still holds
  }
}

export type ApiFootballGetResult =
  | { ok: true; json: unknown; status: number; fromCache: boolean }
  | { ok: false; error: string; status: number; fromCache: boolean }

export async function apiFootballGet(
  path: string,
  ttlMs: number,
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<ApiFootballGetResult> {
  const key = path
  const cached = await readHttpCache(key, now)
  if (cached != null) return { ok: true, json: cached, status: 200, fromCache: true }

  if (!process.env.API_SPORTS_KEY?.trim()) {
    return { ok: false, error: 'API_SPORTS_KEY is not set', status: 0, fromCache: false }
  }

  let lastError = 'API-Football request failed'
  let lastStatus = 0
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForSlot()
    const url = path.startsWith('http') ? path : `${API_FOOTBALL_BASE}${path.startsWith('/') ? path : `/${path}`}`
    const res = await fetchJson(url, { headers: apiHeaders() }, fetchImpl)
    void bumpUsage(utcDay(now))
    if (res.ok) {
      const plan = parseApiFootballErrors(res.json)
      if (plan) return { ok: false, error: plan, status: res.status, fromCache: false }
      await writeHttpCache(key, res.json, ttlMs, now)
      return { ok: true, json: res.json, status: res.status, fromCache: false }
    }
    lastError = res.error
    lastStatus = res.status
    const retryable = res.status === 429 || res.status >= 500 || res.status === 0
    if (!retryable || attempt === MAX_RETRIES) break
    const backoff = Math.min(8_000, 400 * 2 ** attempt)
    await sleep(backoff)
  }
  return { ok: false, error: lastError, status: lastStatus, fromCache: false }
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export async function fetchFixturesByDate(dateYmd: string, now = new Date()) {
  const res = await apiFootballGet(`/fixtures?date=${dateYmd}`, HOUR, now)
  if (!res.ok) return { fixtures: [] as ApiFootballFixture[], error: res.error }
  return { fixtures: parseApiFootballFixtures(res.json), error: null }
}

export async function fetchFixtureById(fixtureId: number, now = new Date()) {
  const res = await apiFootballGet(`/fixtures?id=${fixtureId}`, HOUR, now)
  if (!res.ok) return { fixture: null, error: res.error }
  return { fixture: parseApiFootballFixtures(res.json)[0] ?? null, error: null }
}

export async function searchLeagues(q: string, now = new Date()) {
  const res = await apiFootballGet(`/leagues?search=${encodeURIComponent(q)}`, DAY, now)
  return res
}

export async function searchTeams(
  q: string,
  now = new Date(),
): Promise<{ teams: ApiFootballTeamRef[]; error: string | null }> {
  const seeded = resolveFootballSearchName(q) ?? q
  if (!isApiFootballSearchQuery(seeded)) return { teams: [], error: null }
  const res = await apiFootballGet(teamsSearchPath(seeded), DAY, now)
  if (!res.ok) return { teams: [], error: res.error }
  return { teams: parseApiFootballTeams(res.json), error: null }
}

export async function fetchStandings(leagueId: number, season: number, now = new Date()) {
  const res = await apiFootballGet(`/standings?league=${leagueId}&season=${season}`, DAY, now)
  if (!res.ok) return { rows: [] as ApiFootballStandingRow[], error: res.error }
  return { rows: parseApiFootballStandings(res.json), error: null }
}

export async function fetchHeadToHead(homeId: number, awayId: number, now = new Date()) {
  const res = await apiFootballGet(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=5`, DAY, now)
  if (!res.ok) return { fixtures: [] as ApiFootballFixture[], error: res.error }
  return { fixtures: parseApiFootballFixtures(res.json), error: null }
}

export async function fetchHeadToHeadUpcoming(homeId: number, awayId: number, now = new Date()) {
  const res = await apiFootballGet(headToHeadUpcomingPath(homeId, awayId, now), HOUR, now)
  if (!res.ok) return { fixtures: [] as ApiFootballFixture[], error: res.error }
  return { fixtures: parseApiFootballFixtures(res.json), error: null }
}

export async function fetchInjuriesByFixture(fixtureId: number, now = new Date()) {
  const res = await apiFootballGet(`/injuries?fixture=${fixtureId}`, HOUR, now)
  if (!res.ok) return { injuries: [] as ApiFootballInjury[], error: res.error }
  return { injuries: parseApiFootballInjuries(res.json), error: null }
}

export async function fetchInjuriesByTeam(teamId: number, season: number, now = new Date()) {
  const res = await apiFootballGet(`/injuries?team=${teamId}&season=${season}`, HOUR, now)
  if (!res.ok) return { injuries: [] as ApiFootballInjury[], error: res.error }
  return { injuries: parseApiFootballInjuries(res.json), error: null }
}

/** Consensus extra seat only. Official packets stay off API-Football odds. */
export async function fetchFixtureMatchWinnerDevig(fixtureId: number, teams: SportsTeams, now = new Date()) {
  const res = await apiFootballGet(apiFootballOddsPath(fixtureId), HOUR, now)
  if (!res.ok) return { devig: null as DevigResult | null, error: res.error }
  return { devig: apiFootballDevig(res.json, teams), error: null }
}

export async function fetchLineups(fixtureId: number, kickoffIso: string, now = new Date()) {
  const res = await apiFootballGet(`/fixtures/lineups?fixture=${fixtureId}`, HOUR, now)
  if (!res.ok) return { snapshot: parseApiFootballLineups({ response: [] }, kickoffIso, now, fixtureId), error: res.error }
  return { snapshot: parseApiFootballLineups(res.json, kickoffIso, now, fixtureId), error: null }
}

export async function fetchTeamStatistics(teamId: number, leagueId: number, season: number, team: ApiFootballTeamRef, now = new Date()) {
  const res = await apiFootballGet(`/teams/statistics?team=${teamId}&league=${leagueId}&season=${season}`, DAY, now)
  if (!res.ok) return { stats: null as ApiFootballTeamStats | null, error: res.error }
  return { stats: parseApiFootballTeamStatistics(res.json, team), error: null }
}

export async function fetchTeamUpcoming(teamId: number, now = new Date()) {
  const primary = await apiFootballGet(teamUpcomingPath(teamId, now), HOUR, now)
  if (primary.ok) {
    const fixtures = parseApiFootballFixtures(primary.json)
    if (fixtures.length) return { fixtures, error: null }
  } else if (primary.error) {
    const fallback = await apiFootballGet(teamUpcomingFallbackPath(teamId, now), HOUR, now)
    if (!fallback.ok) return { fixtures: [] as ApiFootballFixture[], error: fallback.error }
    return { fixtures: parseApiFootballFixtures(fallback.json), error: null }
  }
  const fallback = await apiFootballGet(teamUpcomingFallbackPath(teamId, now), HOUR, now)
  if (!fallback.ok) return { fixtures: [] as ApiFootballFixture[], error: primary.ok ? null : primary.error }
  return { fixtures: parseApiFootballFixtures(fallback.json), error: null }
}

export async function fetchFixturesByLeague(leagueId: number, now = new Date()) {
  const res = await apiFootballGet(`/fixtures?league=${leagueId}&next=20`, HOUR, now)
  if (!res.ok) return { fixtures: [] as ApiFootballFixture[], error: res.error }
  return { fixtures: parseApiFootballFixtures(res.json), error: null }
}

function fixtureToLite(f: ApiFootballFixture): FootballSearchFixture {
  return {
    fixture_id: encodeApiFootballEventId(f.fixtureId),
    league: footballLeagueKeyFromApiId(f.leagueId, f.leagueName),
    home: f.home.name,
    away: f.away.name,
    kickoff: f.date,
  }
}

function inSearchWindow(dateIso: string, now: Date): boolean {
  const t = Date.parse(dateIso)
  return Number.isFinite(t) && t > now.getTime() - 3 * 60 * 60 * 1000 && t <= now.getTime() + FOOTBALL_SEARCH_WINDOW_MS
}

export async function searchFootballFixtures(raw: string, now = new Date()): Promise<FootballSearchResult> {
  const leagueIds = extractFootballLeagueHits(raw)
  const queries = footballTeamSearchQueries(raw)

  if (!queries.length && !leagueIds.length) return { fixtures: [], reason: 'ok' }

  let apiFailed = false
  const groups: ApiFootballTeamRef[][] = []
  for (const q of queries) {
    const seen = new Set<number>()
    const pool: ApiFootballTeamRef[] = []
    for (const s of broadenTeamSearchQueries(q)) {
      const found = await searchTeams(s, now)
      if (found.error) apiFailed = true
      for (const t of found.teams) {
        if (seen.has(t.id)) continue
        seen.add(t.id)
        pool.push(t)
      }
    }
    const ranked = rankTeamCandidates(pool, q).slice(0, 3)
    if (ranked.length) groups.push(ranked)
  }
  const teams = groups.flat()

  if (queries.length && !groups.length) {
    return { fixtures: [], reason: apiFailed ? 'api_failure' : 'team_not_found' }
  }

  const collected: ApiFootballFixture[] = []
  const fetchErrors: string[] = []
  const take = (rows: readonly ApiFootballFixture[], error: string | null) => {
    if (error) fetchErrors.push(error)
    collected.push(...rows)
  }

  if (groups.length >= 2) {
    const a = groups[0]![0]!
    const b = groups[1]!.find((t) => t.id !== a.id) ?? groups[1]![0]!
    const first = await fetchTeamUpcoming(a.id, now)
    take(first.fixtures, first.error)
    let pair = fixturesMatchingBothTeams(first.fixtures, a.id, b.id)
    if (!pair.length) {
      const second = await fetchTeamUpcoming(b.id, now)
      take(second.fixtures, second.error)
      pair = fixturesMatchingBothTeams([...first.fixtures, ...second.fixtures], a.id, b.id)
    }
    if (!pair.length) {
      const h2h = await fetchHeadToHeadUpcoming(a.id, b.id, now)
      take(h2h.fixtures, h2h.error)
      pair = fixturesMatchingBothTeams(h2h.fixtures, a.id, b.id)
    }
    const h2hPick = selectNextScheduledFixture(pair, now)
    if (h2hPick) return { fixtures: [fixtureToLite(h2hPick)], reason: 'ok' }
    if (fetchErrors.length && !collected.length) return { fixtures: [], reason: 'api_failure' }
    if (collected.some((f) => isRefusedFootballCompetition(f.leagueId, f.leagueName) && inSearchWindow(f.date, now))) {
      return { fixtures: [], reason: 'non_public_fixture' }
    }
    return { fixtures: [], reason: 'no_upcoming_fixture' }
  }

  if (teams.length >= 1) {
    let sawRefused = false
    for (const team of teams.slice(0, 3)) {
      const upcoming = await fetchTeamUpcoming(team.id, now)
      take(upcoming.fixtures, upcoming.error)
      const next = selectNextScheduledFixture(upcoming.fixtures, now)
      if (next) return { fixtures: [fixtureToLite(next)], reason: 'ok' }
      if (upcoming.fixtures.some((f) => isRefusedFootballCompetition(f.leagueId, f.leagueName) && inSearchWindow(f.date, now))) {
        sawRefused = true
      }
    }
    if (fetchErrors.length && !collected.length) return { fixtures: [], reason: 'api_failure' }
    if (sawRefused) return { fixtures: [], reason: 'non_public_fixture' }
    return { fixtures: [], reason: 'no_upcoming_fixture' }
  }

  for (const id of leagueIds.slice(0, 3)) {
    const { fixtures: rows, error } = await fetchFixturesByLeague(id, now)
    take(rows, error)
  }
  const next = selectNextScheduledFixture(collected, now)
  if (next) return { fixtures: [fixtureToLite(next)], reason: 'ok' }
  if (fetchErrors.length && !collected.length) return { fixtures: [], reason: 'api_failure' }
  if (collected.some((f) => isRefusedFootballCompetition(f.leagueId, f.leagueName) && inSearchWindow(f.date, now))) {
    return { fixtures: [], reason: 'non_public_fixture' }
  }
  return { fixtures: [], reason: leagueIds.length ? 'no_upcoming_fixture' : 'ok' }
}

export async function loadFootballMatchFacts(
  fixtureId: number,
  now = new Date(),
): Promise<FootballMatchFacts> {
  const { fixture, error } = await fetchFixtureById(fixtureId, now)
  if (!fixture) {
    return footballFactsFromParts({
      fixture: null,
      standings: [],
      h2h: [],
      injuries: [],
      lineups: null,
      homeStats: null,
      awayStats: null,
      unavailable: error ?? 'API-Football fixture not found',
    })
  }
  const season = fixture.season ?? new Date(fixture.date).getUTCFullYear()
  const [standings, h2h, injFix, injHome, injAway, lineups, homeStats, awayStats] = await Promise.all([
    fetchStandings(fixture.leagueId, season, now),
    fetchHeadToHead(fixture.home.id, fixture.away.id, now),
    fetchInjuriesByFixture(fixture.fixtureId, now),
    fetchInjuriesByTeam(fixture.home.id, season, now),
    fetchInjuriesByTeam(fixture.away.id, season, now),
    fetchLineups(fixture.fixtureId, fixture.date, now),
    fetchTeamStatistics(fixture.home.id, fixture.leagueId, season, fixture.home, now),
    fetchTeamStatistics(fixture.away.id, fixture.leagueId, season, fixture.away, now),
  ])
  const injuries = [...injFix.injuries, ...injHome.injuries, ...injAway.injuries]
  const seen = new Set<string>()
  const deduped = injuries.filter((i) => {
    const key = `${i.teamId}:${i.player}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return footballFactsFromParts({
    fixture,
    standings: standings.rows,
    h2h: h2h.fixtures.filter((f) => f.fixtureId !== fixture.fixtureId && isFinishedish(f)),
    injuries: deduped,
    lineups: lineups.snapshot,
    homeStats: homeStats.stats,
    awayStats: awayStats.stats,
  })
}

function isFinishedish(f: ApiFootballFixture): boolean {
  return ['FT', 'AET', 'PEN'].includes(f.statusShort)
}

export async function resolveFixtureIdForParts(
  eventId: string,
  hint?: { home: string; away: string; kickoffIso: string },
  now = new Date(),
): Promise<number | null> {
  const direct = parseApiFootballEventId(eventId)
  if (direct != null) return direct
  if (!hint) return null
  const date = hint.kickoffIso.slice(0, 10)
  const { fixtures } = await fetchFixturesByDate(date, now)
  const hit = fixtures.find(
    (f) =>
      (teamsMatch(f.home.name, hint.home) && teamsMatch(f.away.name, hint.away)) ||
      (teamsMatch(f.home.name, hint.away) && teamsMatch(f.away.name, hint.home)),
  )
  return hit?.fixtureId ?? null
}

export { parseApiFootballEventId, encodeApiFootballEventId }
