import { describe, expect, it } from 'vitest'
import {
  computeFip,
  parseInningsPitched,
  parseMlbTeamPitching,
  parseNbaAdvanced,
  parseSavantExpectedCsv,
  parseUnderstatLeague,
  understatSeasonYear,
} from '../stats-parse'

describe('Understat xG rollup', () => {
  it('sums history xG/xGA per team', () => {
    const rows = parseUnderstatLeague({
      teams: {
        '83': {
          id: '83',
          title: 'Arsenal',
          history: [
            { xG: 2.1, xGA: 0.8, xpts: 2.4 },
            { xG: 1.4, xGA: 1.1, xpts: 1.6 },
          ],
        },
      },
    })
    expect(rows[0]).toMatchObject({ team: 'Arsenal', matches: 2, xg: 3.5, xga: 1.9, xgd: 1.6, xpts: 4 })
  })

  it('uses the August-start season year', () => {
    expect(understatSeasonYear('2026-10-10T11:30:00Z', new Date('2026-09-27Z'))).toBe(2026)
    expect(understatSeasonYear('2026-03-01T15:00:00Z', new Date('2026-03-01Z'))).toBe(2025)
  })
})

describe('MLB FIP', () => {
  it('parses 169.1 IP as 169 + 1/3 and matches the Misiorowski probe', () => {
    expect(parseInningsPitched('169.1')).toBeCloseTo(169 + 1 / 3, 8)
    const fip = computeFip({ hr: 14, bb: 42, hbp: 9, k: 247, ip: parseInningsPitched('169.1') })
    expect(fip).toBeCloseTo(2.16, 2)
  })

  it('reads team pitching splits from the MLB Stats API envelope', () => {
    const rows = parseMlbTeamPitching({
      stats: [
        {
          splits: [
            {
              team: { name: 'Milwaukee Brewers' },
              stat: { era: '3.20', whip: '1.10', inningsPitched: '1440.0', homeRuns: 140, baseOnBalls: 420, hitByPitch: 50, strikeOuts: 1400 },
            },
          ],
        },
      ],
    })
    expect(rows[0]?.team).toBe('Milwaukee Brewers')
    expect(rows[0]?.fip).not.toBeNull()
  })
})

describe('Savant xwOBA CSV', () => {
  it('reads est_woba from the expected-statistics export', () => {
    const csv = `"last_name, first_name","player_id","year","pa","est_woba"
"Crow-Armstrong, Pete","691718","2026","725",0.374`
    const rows = parseSavantExpectedCsv(csv)
    expect(rows[0]).toMatchObject({ pa: 725, xwoba: 0.374 })
  })
})

describe('NBA advanced', () => {
  it('maps NET_RATING and PACE out of leaguedashteamstats', () => {
    const rows = parseNbaAdvanced({
      resultSets: [
        {
          headers: ['TEAM_NAME', 'NET_RATING', 'PACE', 'OFF_RATING', 'DEF_RATING'],
          rowSet: [['Atlanta Hawks', 2.2, 102.5, 115, 112.9]],
        },
      ],
    })
    expect(rows[0]).toEqual({
      team: 'Atlanta Hawks',
      netRating: 2.2,
      pace: 102.5,
      offRating: 115,
      defRating: 112.9,
    })
  })
})
