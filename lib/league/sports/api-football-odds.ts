/**
 * API-Football `/odds` Match Winner prices → the same de-vigged result the
 * Odds API path stores on the fixture cache. Book names stay internal: the
 * consensus seat shows the team and the probability only.
 */

import { pickPreferredBook } from './books'
import { toDevigResult } from './devig'
import type { DevigResult, OddsBookmaker, SportsTeams } from './types'

/** API-Football bet id for full-time home / draw / away. */
export const API_FOOTBALL_MATCH_WINNER_BET_ID = 1

export function apiFootballOddsPath(fixtureId: number): string {
  return `/odds?fixture=${fixtureId}&bet=${API_FOOTBALL_MATCH_WINNER_BET_ID}`
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

function asArray(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : []
}

function bookKey(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'book'
}

function isMatchWinner(bet: Record<string, unknown>): boolean {
  return Number(bet.id) === API_FOOTBALL_MATCH_WINNER_BET_ID || /^match winner$/i.test(String(bet.name ?? '').trim())
}

/** Books that price all three of home / draw / away; a two-way 1X2 cannot be de-vigged honestly. */
export function parseApiFootballMatchWinner(json: unknown, teams: SportsTeams): OddsBookmaker[] {
  const entry = asRecord(asArray(asRecord(json)?.response)[0])
  const out: OddsBookmaker[] = []
  for (const rawBook of asArray(entry?.bookmakers)) {
    const book = asRecord(rawBook)
    const title = typeof book?.name === 'string' ? book.name.trim() : ''
    if (!book || !title) continue
    const bet = asArray(book.bets).map(asRecord).find((b): b is Record<string, unknown> => b != null && isMatchWinner(b))
    if (!bet) continue
    const priced = new Map<string, number>()
    for (const rawValue of asArray(bet.values)) {
      const value = asRecord(rawValue)
      const side = String(value?.value ?? '').trim().toLowerCase()
      const price = Number(value?.odd)
      if (!Number.isFinite(price) || price <= 1) continue
      if (side === 'home' || side === 'draw' || side === 'away') priced.set(side, price)
    }
    const home = priced.get('home')
    const draw = priced.get('draw')
    const away = priced.get('away')
    if (home == null || draw == null || away == null) continue
    out.push({
      key: bookKey(title),
      title,
      markets: [
        {
          key: 'h2h',
          outcomes: [
            { name: teams.home, price: home },
            { name: 'Draw', price: draw },
            { name: teams.away, price: away },
          ],
        },
      ],
    })
  }
  return out
}

export function apiFootballDevig(json: unknown, teams: SportsTeams): DevigResult | null {
  const picked = pickPreferredBook(parseApiFootballMatchWinner(json, teams))
  if (!picked) return null
  return toDevigResult({
    bookKey: picked.book.key,
    bookTitle: picked.book.title,
    bookClass: picked.bookClass,
    outcomes: picked.outcomes,
    limitation: picked.limitation,
  })
}
