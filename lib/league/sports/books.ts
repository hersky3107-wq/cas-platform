/**
 * Book ranking for the Odds API slate.
 *
 * Probe (2026-09-27, THE_ODDS_API free 500/mo, regions=eu, soccer_epl h2h):
 * Pinnacle AND Betfair Exchange are on the free key. Recreational books
 * (William Hill, Unibet, 888sport, …) are also present. Bet365 / DraftKings
 * did not appear on the EU soccer snapshot.
 *
 * We always prefer Pinnacle when it prices the market; then other sharp
 * keys; then the recreational book with the lowest overround.
 */

import { SHARP_BOOK_KEYS, type OddsBookmaker, type SharpBookKey } from './types'
import { rawImplied } from './devig'

export function isSharpBook(key: string): key is SharpBookKey {
  return (SHARP_BOOK_KEYS as readonly string[]).includes(key)
}

export function h2hOutcomes(book: OddsBookmaker): Array<{ name: string; price: number }> | null {
  const market = book.markets.find((m) => m.key === 'h2h')
  const outcomes = market?.outcomes ?? []
  const usable = outcomes.filter((o) => Number.isFinite(o.price) && o.price > 1)
  if (usable.length < 2) return null
  return usable.map((o) => ({ name: o.name, price: o.price }))
}

export function booksumOf(outcomes: ReadonlyArray<{ price: number }>): number {
  return outcomes.reduce((s, o) => s + rawImplied(o.price), 0)
}

export type PickedBook = {
  book: OddsBookmaker
  outcomes: Array<{ name: string; price: number }>
  bookClass: 'sharp' | 'recreational'
  limitation: string | null
}

const SHARP_RANK: Record<string, number> = {
  pinnacle: 0,
  betfair_ex_eu: 1,
  betfair_ex_uk: 2,
  matchbook: 3,
  smarkets: 4,
}

export function pickPreferredBook(bookmakers: readonly OddsBookmaker[]): PickedBook | null {
  const priced: Array<{ book: OddsBookmaker; outcomes: NonNullable<ReturnType<typeof h2hOutcomes>> }> = []
  for (const book of bookmakers) {
    const outcomes = h2hOutcomes(book)
    if (outcomes) priced.push({ book, outcomes })
  }
  if (priced.length === 0) return null

  const pinnacle = priced.find((p) => p.book.key === 'pinnacle')
  if (pinnacle) {
    return {
      book: pinnacle.book,
      outcomes: pinnacle.outcomes,
      bookClass: 'sharp',
      limitation: null,
    }
  }

  const sharp = priced
    .filter((p) => isSharpBook(p.book.key))
    .sort((a, b) => (SHARP_RANK[a.book.key] ?? 99) - (SHARP_RANK[b.book.key] ?? 99))
  if (sharp[0]) {
    return {
      book: sharp[0].book,
      outcomes: sharp[0].outcomes,
      bookClass: 'sharp',
      limitation: 'Pinnacle missing on this event; next-best sharp book used.',
    }
  }

  const recreational = [...priced].sort((a, b) => booksumOf(a.outcomes) - booksumOf(b.outcomes))
  const best = recreational[0]
  if (!best) return null
  return {
    book: best.book,
    outcomes: best.outcomes,
    bookClass: 'recreational',
    limitation:
      'No sharp book (Pinnacle/Betfair/Matchbook/Smarkets) on this event. Using the recreational book with the lowest overround.',
  }
}
