import 'server-only'

import { listLeagueCache, upsertFixtureCacheMany } from './cache'
import { fetchJson } from './http'
import { cacheRowFromOddsEvent, mergeOddsIntoRow, oddsCacheFresh, parseOddsApiEvents, readQuotaHeaders } from './odds-logic'
import type { SportsFixtureCacheRow, SportsLeagueKey } from './types'

const ODDS_API = 'https://api.the-odds-api.com/v4/sports'

const REGION: Record<SportsLeagueKey, string> = {
  soccer_epl: 'eu',
  baseball_mlb: 'us',
  basketball_nba: 'us',
}

export type OddsSlateResult = {
  league: SportsLeagueKey
  fromCache: boolean
  events: number
  rows: SportsFixtureCacheRow[]
  remaining: number | null
  used: number | null
  error: string | null
}

/**
 * One Odds API request = the whole league slate. Cached 5h in
 * sports_fixture_cache. Confirmed lineups on existing rows are preserved.
 */
export async function fetchOddsSlate(
  league: SportsLeagueKey,
  now = new Date(),
  fetchImpl: typeof fetch = fetch
): Promise<OddsSlateResult> {
  const cached = await listLeagueCache(league).catch(() => [] as SportsFixtureCacheRow[])
  const upcoming = cached.filter((r) => Date.parse(r.kickoff) > now.getTime() - 3 * 60 * 60 * 1000)
  if (upcoming.length > 0 && upcoming.every((r) => oddsCacheFresh(r, now))) {
    return {
      league,
      fromCache: true,
      events: upcoming.length,
      rows: upcoming,
      remaining: null,
      used: null,
      error: null,
    }
  }

  const key = process.env.THE_ODDS_API_KEY?.trim()
  if (!key) {
    return { league, fromCache: false, events: 0, rows: cached, remaining: null, used: null, error: 'THE_ODDS_API_KEY is not set' }
  }

  const url = `${ODDS_API}/${encodeURIComponent(league)}/odds?regions=${REGION[league]}&markets=h2h&oddsFormat=decimal&apiKey=${encodeURIComponent(key)}`
  const res = await fetchJson(url, {}, fetchImpl)
  if (!res.ok) {
    return { league, fromCache: false, events: 0, rows: cached, remaining: null, used: null, error: res.error }
  }

  const quota = readQuotaHeaders(res.headers)
  const events = parseOddsApiEvents(res.json)
  const existingById = new Map(cached.map((r) => [r.fixture_id, r]))
  const rows: SportsFixtureCacheRow[] = []
  for (const event of events) {
    const built = cacheRowFromOddsEvent(event, now, league)
    if (!built) continue
    rows.push(mergeOddsIntoRow(existingById.get(event.id) ?? null, built))
  }

  try {
    await upsertFixtureCacheMany(rows)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'cache write failed'
    return { league, fromCache: false, events: rows.length, rows, remaining: quota.remaining, used: quota.used, error: msg }
  }

  return {
    league,
    fromCache: false,
    events: rows.length,
    rows,
    remaining: quota.remaining,
    used: quota.used,
    error: null,
  }
}
