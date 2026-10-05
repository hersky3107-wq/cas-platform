import { describe, expect, it } from 'vitest'
import {
  broadenTeamSearchQueries,
  footballSearchSeason,
  headToHeadUpcomingPath,
  pickPreferredTeam,
  selectNextScheduledFixture,
  teamUpcomingFallbackPath,
  teamUpcomingPath,
  teamsSearchPath,
} from '../api-football-search'
import type { ApiFootballFixture } from '../api-football-parse'

const NOW = new Date('2026-10-05T00:00:00.000Z')

function fixture(partial: Partial<ApiFootballFixture> & { fixtureId: number; date: string }): ApiFootballFixture {
  return {
    timestamp: Date.parse(partial.date) / 1000,
    statusShort: 'NS',
    statusLong: 'Not Started',
    leagueId: 292,
    leagueName: 'K League 1',
    leagueCountry: 'South-Korea',
    season: 2026,
    round: 'Regular Season',
    home: { id: 2763, name: 'Ulsan Hyundai FC' },
    away: { id: 2764, name: 'Gwangju FC' },
    goalsHome: null,
    goalsAway: null,
    fulltimeHome: null,
    fulltimeAway: null,
    extratimeHome: null,
    extratimeAway: null,
    penaltyHome: null,
    penaltyAway: null,
    ...partial,
  }
}

describe('API-Football search helpers', () => {
  it('maps aliases onto an official team id (Ulsan HD / Hyundai over Citizen)', () => {
    const picked = pickPreferredTeam(
      [
        { id: 2765, name: 'Ulsan Citizen' },
        { id: 2763, name: 'Ulsan Hyundai FC' },
        { id: 9001, name: 'Ulsan University' },
      ],
      'Ulsan',
    )
    expect(picked).toEqual({ id: 2763, name: 'Ulsan Hyundai FC' })
    expect(
      pickPreferredTeam(
        [
          { id: 1860, name: 'Bayern Munich W' },
          { id: 157, name: 'Bayern Munich' },
        ],
        'Bayern',
      )?.id,
    ).toBe(157)
    expect(broadenTeamSearchQueries('Kashima Antlers')).toEqual(['Kashima Antlers', 'Kashima'])
  })

  it('puts season=2026 and next=5 on the upcoming path', () => {
    expect(footballSearchSeason(NOW)).toBe(2026)
    expect(teamsSearchPath('Ulsan')).toBe('/teams?search=Ulsan')
    expect(teamUpcomingPath(2763, NOW)).toBe(
      '/fixtures?team=2763&next=5&season=2026&timezone=Asia/Seoul',
    )
    expect(teamUpcomingFallbackPath(2763, NOW)).toBe(
      '/fixtures?team=2763&season=2026&from=2026-10-05&to=2026-11-09&timezone=Asia/Seoul',
    )
    expect(headToHeadUpcomingPath(47, 42, NOW)).toBe(
      '/fixtures/headtohead?h2h=47-42&next=5&season=2026&timezone=Asia/Seoul',
    )
  })

  it('selects the first scheduled fixture inside the 35-day window', () => {
    const next = selectNextScheduledFixture(
      [
        fixture({ fixtureId: 1, date: '2026-10-17T07:30:00+00:00', home: { id: 2763, name: 'Ulsan Hyundai FC' }, away: { id: 11, name: 'Bucheon FC 1995' } }),
        fixture({ fixtureId: 2, date: '2026-10-11T05:00:00+00:00', home: { id: 2764, name: 'Gwangju FC' }, away: { id: 2763, name: 'Ulsan Hyundai FC' } }),
        fixture({ fixtureId: 3, date: '2026-09-01T05:00:00+00:00', statusShort: 'FT', statusLong: 'Match Finished' }),
        fixture({
          fixtureId: 4,
          date: '2026-10-12T05:00:00+00:00',
          leagueId: 294,
          leagueName: 'K3 League',
          home: { id: 2765, name: 'Ulsan Citizen' },
          away: { id: 12, name: 'Paju Citizen' },
        }),
      ],
      NOW,
    )
    expect(next?.fixtureId).toBe(2)
  })

  it('matches A vs B by both team ids', () => {
    const tot = selectNextScheduledFixture(
      [
        fixture({
          fixtureId: 50,
          date: '2026-10-08T19:00:00+00:00',
          leagueId: 39,
          leagueName: 'Premier League',
          home: { id: 47, name: 'Tottenham' },
          away: { id: 42, name: 'Arsenal' },
        }),
        fixture({
          fixtureId: 51,
          date: '2026-10-06T14:00:00+00:00',
          leagueId: 39,
          leagueName: 'Premier League',
          home: { id: 47, name: 'Tottenham' },
          away: { id: 33, name: 'Manchester United' },
        }),
      ],
      NOW,
      42,
    )
    expect(tot?.fixtureId).toBe(50)
  })
})
