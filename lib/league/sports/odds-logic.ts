/**
 * Odds-API payload → cache rows. Pure.
 * One HTTP call returns the whole league slate; this just maps it.
 */

import { pickPreferredBook } from './books'
import { toDevigResult } from './devig'
import { SPORTS_ODDS_TTL_MS, type OddsEvent, type SportsFixtureCacheRow } from './types'

export function parseOddsApiEvents(raw: unknown): OddsEvent[] {
  if (!Array.isArray(raw)) return []
  const events: OddsEvent[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const id = typeof rec.id === 'string' ? rec.id : ''
    const home = typeof rec.home_team === 'string' ? rec.home_team : ''
    const away = typeof rec.away_team === 'string' ? rec.away_team : ''
    const commence = typeof rec.commence_time === 'string' ? rec.commence_time : ''
    if (!id || !home || !away || !commence) continue
    const bookmakers = Array.isArray(rec.bookmakers)
      ? rec.bookmakers.flatMap((b) => parseBookmaker(b))
      : []
    events.push({
      id,
      sportKey: typeof rec.sport_key === 'string' ? rec.sport_key : '',
      home,
      away,
      commenceTime: commence,
      bookmakers,
    })
  }
  return events
}

function parseBookmaker(raw: unknown): Array<OddsEvent['bookmakers'][number]> {
  if (!raw || typeof raw !== 'object') return []
  const rec = raw as Record<string, unknown>
  const key = typeof rec.key === 'string' ? rec.key : ''
  if (!key) return []
  const markets = Array.isArray(rec.markets)
    ? rec.markets.flatMap((m) => {
        if (!m || typeof m !== 'object') return []
        const mr = m as Record<string, unknown>
        const mkey = typeof mr.key === 'string' ? mr.key : ''
        if (!mkey) return []
        const outcomes = Array.isArray(mr.outcomes)
          ? mr.outcomes.flatMap((o) => {
              if (!o || typeof o !== 'object') return []
              const or = o as Record<string, unknown>
              const name = typeof or.name === 'string' ? or.name : ''
              const price = typeof or.price === 'number' ? or.price : Number(or.price)
              if (!name || !Number.isFinite(price)) return []
              return [{ name, price }]
            })
          : []
        return [{ key: mkey, outcomes }]
      })
    : []
  return [
    {
      key,
      title: typeof rec.title === 'string' ? rec.title : key,
      markets,
    },
  ]
}

export function readQuotaHeaders(headers: Headers): { remaining: number | null; used: number | null } {
  const remaining = Number(headers.get('x-requests-remaining'))
  const used = Number(headers.get('x-requests-used'))
  return {
    remaining: Number.isFinite(remaining) ? remaining : null,
    used: Number.isFinite(used) ? used : null,
  }
}

export function cacheRowFromOddsEvent(
  event: OddsEvent,
  now: Date,
  league: string
): SportsFixtureCacheRow | null {
  const picked = pickPreferredBook(event.bookmakers)
  if (!picked) return null
  const nowIso = now.toISOString()
  return {
    fixture_id: event.id,
    league,
    teams: { home: event.home, away: event.away },
    kickoff: event.commenceTime,
    devigged_odds: toDevigResult({
      bookKey: picked.book.key,
      bookTitle: picked.book.title,
      bookClass: picked.bookClass,
      outcomes: picked.outcomes,
      limitation: picked.limitation,
    }),
    lineups: null,
    stats: null,
    fetched_at: nowIso,
    ttl: new Date(now.getTime() + SPORTS_ODDS_TTL_MS).toISOString(),
  }
}

/** `/events` rows have no books — discovery only. Generate still fetches `/odds`. */
export function cacheRowFromScheduleEvent(
  event: Pick<OddsEvent, 'id' | 'home' | 'away' | 'commenceTime'>,
  now: Date,
  league: string
): SportsFixtureCacheRow | null {
  if (!event.id || !event.home || !event.away || !event.commenceTime) return null
  const nowIso = now.toISOString()
  return {
    fixture_id: event.id,
    league,
    teams: { home: event.home, away: event.away },
    kickoff: event.commenceTime,
    devigged_odds: null,
    lineups: null,
    stats: null,
    fetched_at: nowIso,
    ttl: new Date(now.getTime() + SPORTS_ODDS_TTL_MS).toISOString(),
  }
}

export function eventsCacheFresh(row: { ttl: string } | null, now: Date): boolean {
  if (!row) return false
  const ms = Date.parse(row.ttl)
  return Number.isFinite(ms) && ms > now.getTime()
}

export function oddsCacheFresh(row: { ttl: string; devigged_odds?: unknown } | null, now: Date): boolean {
  if (!row || row.devigged_odds == null) return false
  return eventsCacheFresh(row, now)
}

/** Merge a new odds snapshot onto an existing cache row without wiping confirmed lineups. */
export function mergeOddsIntoRow(
  existing: SportsFixtureCacheRow | null,
  next: SportsFixtureCacheRow
): SportsFixtureCacheRow {
  if (!existing) return next
  const keepLineups = existing.lineups?.immutable ? existing.lineups : next.lineups ?? existing.lineups
  const keepStats =
    existing.stats && Date.parse(existing.stats.fetchedAt) > Date.parse(next.fetched_at) - SPORTS_ODDS_TTL_MS
      ? existing.stats
      : next.stats ?? existing.stats
  return {
    ...next,
    lineups: keepLineups,
    stats: keepStats,
  }
}

/** Overlay a 0-credit `/events` snapshot without wiping a priced `/odds` row. */
export function mergeScheduleIntoRow(
  existing: SportsFixtureCacheRow | null,
  next: SportsFixtureCacheRow
): SportsFixtureCacheRow {
  if (!existing) return next
  const keepLineups = existing.lineups?.immutable ? existing.lineups : existing.lineups ?? next.lineups
  const keepStats = existing.stats ?? next.stats
  return {
    ...next,
    devigged_odds: existing.devigged_odds ?? next.devigged_odds,
    lineups: keepLineups,
    stats: keepStats,
  }
}
