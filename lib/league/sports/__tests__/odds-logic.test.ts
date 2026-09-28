import { describe, expect, it } from 'vitest'
import { pickPreferredBook, isSharpBook } from '../books'
import { cacheRowFromOddsEvent, cacheRowFromScheduleEvent, mergeOddsIntoRow, mergeScheduleIntoRow, oddsCacheFresh, parseOddsApiEvents } from '../odds-logic'
import type { OddsBookmaker, SportsFixtureCacheRow } from '../types'

const pinnacle: OddsBookmaker = {
  key: 'pinnacle',
  title: 'Pinnacle',
  markets: [{ key: 'h2h', outcomes: [
    { name: 'Arsenal', price: 1.38 },
    { name: 'Leeds United', price: 7.65 },
    { name: 'Draw', price: 4.93 },
  ] }],
}

const william: OddsBookmaker = {
  key: 'williamhill',
  title: 'William Hill',
  markets: [{ key: 'h2h', outcomes: [
    { name: 'Arsenal', price: 1.36 },
    { name: 'Leeds United', price: 7.5 },
    { name: 'Draw', price: 4.6 },
  ] }],
}

describe('sharp book preference', () => {
  it('prefers Pinnacle when the free Odds API returns it', () => {
    expect(isSharpBook('pinnacle')).toBe(true)
    const picked = pickPreferredBook([william, pinnacle])
    expect(picked?.book.key).toBe('pinnacle')
    expect(picked?.bookClass).toBe('sharp')
    expect(picked?.limitation).toBeNull()
  })

  it('falls back to lowest-overround recreational when no sharp book prices the market', () => {
    const picked = pickPreferredBook([william])
    expect(picked?.book.key).toBe('williamhill')
    expect(picked?.bookClass).toBe('recreational')
    expect(picked?.limitation).toMatch(/No sharp book/)
  })
})

describe('odds payload → cache row', () => {
  it('parses a slate event and writes Shin probabilities under the Pinnacle book', () => {
    const events = parseOddsApiEvents([
      {
        id: 'b870dcfba5e5920d3f1551a3aa1ea435',
        sport_key: 'soccer_epl',
        home_team: 'Arsenal',
        away_team: 'Leeds United',
        commence_time: '2026-10-10T11:30:00Z',
        bookmakers: [william, pinnacle],
      },
    ])
    expect(events).toHaveLength(1)
    const row = cacheRowFromOddsEvent(events[0]!, new Date('2026-09-27T06:00:00Z'), 'soccer_epl')
    expect(row?.devigged_odds?.bookKey).toBe('pinnacle')
    expect(row?.devigged_odds?.method).toBe('shin')
    const home = row?.devigged_odds?.outcomes.find((o) => o.name === 'Arsenal')
    expect(home?.probability).toBeCloseTo(0.7, 2)
    expect(Date.parse(row!.ttl) - Date.parse(row!.fetched_at)).toBe(5 * 60 * 60 * 1000)
  })

  it('does not overwrite an immutable confirmed lineup on odds refresh', () => {
    const existing: SportsFixtureCacheRow = {
      fixture_id: 'abc',
      league: 'soccer_epl',
      teams: { home: 'Arsenal', away: 'Leeds United' },
      kickoff: '2026-10-10T11:30:00Z',
      devigged_odds: null,
      lineups: {
        confidence: 'confirmed',
        immutable: true,
        provider: 'api_sports',
        fixtureId: 1,
        fetchedAt: '2026-10-10T10:40:00Z',
        teams: [],
        unavailable: null,
      },
      stats: null,
      fetched_at: '2026-10-10T10:40:00Z',
      ttl: '2026-10-10T15:40:00Z',
    }
    const next: SportsFixtureCacheRow = {
      ...existing,
      lineups: null,
      fetched_at: '2026-10-10T16:00:00Z',
      ttl: '2026-10-10T21:00:00Z',
    }
    expect(mergeOddsIntoRow(existing, next).lineups?.immutable).toBe(true)
  })

  it('keeps a schedule row without books and does not treat it as a fresh odds cache', () => {
    const events = parseOddsApiEvents([
      {
        id: 'evt-1',
        sport_key: 'soccer_epl',
        home_team: 'Arsenal',
        away_team: 'Leeds United',
        commence_time: '2026-10-10T11:30:00Z',
      },
    ])
    const now = new Date('2026-09-27T06:00:00Z')
    const scheduled = cacheRowFromScheduleEvent(events[0]!, now, 'soccer_epl')
    expect(scheduled?.devigged_odds).toBeNull()
    expect(oddsCacheFresh(scheduled, now)).toBe(false)
    const priced = cacheRowFromOddsEvent(
      { ...events[0]!, bookmakers: [pinnacle] },
      now,
      'soccer_epl',
    )
    expect(mergeScheduleIntoRow(priced, scheduled!).devigged_odds?.bookKey).toBe('pinnacle')
  })
})
