import { describe, expect, it } from 'vitest'
import {
  inApiSportsFreeDateWindow,
  lineupConfidence,
  normalizeTeamName,
  parseFootballLineups,
  shouldSkipLineupFetch,
  teamsMatch,
} from '../lineup-logic'

describe('lineup confidence clock', () => {
  const kickoff = '2026-10-10T11:30:00Z'

  it('tags projected more than 2h pre-match', () => {
    expect(lineupConfidence(kickoff, new Date('2026-10-10T08:00:00Z'))).toBe('projected')
  })

  it('tags pending inside the 60min–2h window', () => {
    expect(lineupConfidence(kickoff, new Date('2026-10-10T10:00:00Z'))).toBe('pending')
  })

  it('tags confirmed within 60 minutes of kickoff', () => {
    expect(lineupConfidence(kickoff, new Date('2026-10-10T10:45:00Z'))).toBe('confirmed')
    expect(lineupConfidence(kickoff, new Date('2026-10-10T12:00:00Z'))).toBe('confirmed')
  })
})

describe('API-Sports free date window', () => {
  it('allows yesterday/today/tomorrow and refuses a kickoff 13 days out', () => {
    const now = new Date('2026-09-27T06:00:00Z')
    expect(inApiSportsFreeDateWindow('2026-09-26T15:00:00Z', now)).toBe(true)
    expect(inApiSportsFreeDateWindow('2026-09-28T15:00:00Z', now)).toBe(true)
    expect(inApiSportsFreeDateWindow('2026-10-10T11:30:00Z', now)).toBe(false)
  })
})

describe('name matching', () => {
  it('equates Odds-API and API-Sports spellings', () => {
    expect(teamsMatch('Brighton and Hove Albion', 'Brighton')).toBe(true)
    expect(teamsMatch('Tottenham Hotspur', 'Tottenham')).toBe(true)
    expect(teamsMatch('Ulsan HD', 'Ulsan Hyundai FC')).toBe(true)
    expect(teamsMatch('Jeonbuk Motors', 'Jeonbuk Hyundai Motors')).toBe(true)
    expect(normalizeTeamName('Manchester United')).toContain('utd')
  })
})

describe('API-Sports lineup parse', () => {
  it('marks a full 11-a-side historical XI immutable/confirmed', () => {
    const payload = {
      response: [
        {
          team: { name: 'Crystal Palace' },
          formation: '4-2-3-1',
          startXI: Array.from({ length: 11 }, (_, i) => ({ player: { name: `P${i}`, number: i + 1, pos: 'M' } })),
        },
        {
          team: { name: 'Arsenal' },
          formation: '4-3-3',
          startXI: Array.from({ length: 11 }, (_, i) => ({ player: { name: `A${i}`, number: i + 1, pos: 'M' } })),
        },
      ],
    }
    const snap = parseFootballLineups(payload, '2022-08-05T19:00:00Z', new Date('2026-09-27T00:00:00Z'), 867946)
    expect(snap.confidence).toBe('confirmed')
    expect(snap.immutable).toBe(true)
    expect(snap.teams[0]?.startXI).toHaveLength(11)
    expect(shouldSkipLineupFetch(snap)).toBe(true)
  })
})
