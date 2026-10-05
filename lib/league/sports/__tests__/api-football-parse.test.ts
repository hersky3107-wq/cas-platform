import { describe, expect, it } from 'vitest'
import { extractFootballAliasHits, resolveFootballSearchName } from '../api-football-aliases'
import { footballLeagueKeyFromApiId, parseApiFootballEventId } from '../api-football-leagues'
import {
  decideFootballMatchGrade,
  formatFootballGradeEvidence,
  parseApiFootballFixtures,
  parseApiFootballInjuries,
  parseApiFootballStandings,
  parseApiFootballTeamStatistics,
  propositionWantsRegularTime,
} from '../api-football-parse'
import { formatFootballMatchFacts, footballFactsFromParts } from '../api-football-packet'

const FIXTURE_FT = {
  fixture: { id: 867946, date: '2026-10-04T14:00:00+00:00', status: { short: 'FT', long: 'Match Finished' }, timestamp: 1759586400 },
  league: { id: 292, name: 'K League 1', country: 'South-Korea', season: 2026, round: 'Regular Season - 12' },
  teams: { home: { id: 2763, name: 'Ulsan HD' }, away: { id: 2766, name: 'Jeonbuk Motors' } },
  goals: { home: 2, away: 2 },
  score: { fulltime: { home: 1, away: 1 }, extratime: { home: 1, away: 1 }, penalty: { home: null, away: null } },
}

describe('API-Football fixture parse', () => {
  it('reads fixture id, teams, fulltime and extra-time scores', () => {
    const rows = parseApiFootballFixtures({ response: [FIXTURE_FT] })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      fixtureId: 867946,
      home: { name: 'Ulsan HD' },
      away: { name: 'Jeonbuk Motors' },
      fulltimeHome: 1,
      fulltimeAway: 1,
      extratimeHome: 1,
      extratimeAway: 1,
      leagueId: 292,
    })
    expect(footballLeagueKeyFromApiId(292)).toBe('soccer_korea_kleague1')
    expect(parseApiFootballEventId('af-867946')).toBe(867946)
  })

  it('returns empty on a failed payload — does not invent a fixture', () => {
    expect(parseApiFootballFixtures({ errors: { plan: 'blocked' } })).toEqual([])
    expect(parseApiFootballFixtures(null)).toEqual([])
  })
})

describe('K League / J League aliases', () => {
  it('maps Korean and Japanese club names onto API search strings', () => {
    expect(resolveFootballSearchName('울산')).toBe('Ulsan')
    expect(resolveFootballSearchName('전북')).toBe('Jeonbuk Motors')
    expect(resolveFootballSearchName('포항')).toBe('Pohang Steelers')
    expect(resolveFootballSearchName('서울')).toBe('FC Seoul')
    expect(resolveFootballSearchName('수원')).toBe('Suwon')
    expect(resolveFootballSearchName('가시마')).toBe('Kashima Antlers')
    expect(resolveFootballSearchName('우라와')).toBe('Urawa')
    expect(resolveFootballSearchName('요코하마 F. 마리노스')).toBe('Yokohama F. Marinos')
    expect(extractFootballAliasHits('울산 전북')).toEqual(['Ulsan', 'Jeonbuk Motors'])
  })
})

describe('football grading rules', () => {
  const fixture = parseApiFootballFixtures({ response: [FIXTURE_FT] })[0]!

  it('uses score.fulltime when the proposition is regular time; a draw is No', () => {
    expect(propositionWantsRegularTime('Will Ulsan HD win ... in regular time (90 minutes plus stoppage; a draw is No)?')).toBe(true)
    const decision = decideFootballMatchGrade({ fixture, subjectIsHome: true, scoreChoice: 'regular_time' })
    expect(decision).toMatchObject({ kind: 'no', homeGoals: 1, awayGoals: 1, used: 'regular_time' })
    expect(formatFootballGradeEvidence(decision as Extract<typeof decision, { kind: 'yes' | 'no' }>)).toContain('fixture 867946')
  })

  it('uses the official final (AET) when the proposition is not 90 minutes', () => {
    const aet = parseApiFootballFixtures({
      response: [{ ...FIXTURE_FT, fixture: { ...FIXTURE_FT.fixture, status: { short: 'AET', long: 'After Extra Time' } } }],
    })[0]!
    const decision = decideFootballMatchGrade({ fixture: aet, subjectIsHome: true, scoreChoice: 'final' })
    expect(decision).toMatchObject({ kind: 'no', homeGoals: 2, awayGoals: 2, status: 'AET' })
  })

  it('voids postponed / abandoned / cancelled and does not invent a winner', () => {
    for (const short of ['PST', 'CANC', 'ABD']) {
      const row = parseApiFootballFixtures({
        response: [{ ...FIXTURE_FT, fixture: { ...FIXTURE_FT.fixture, status: { short, long: short } } }],
      })[0]!
      expect(decideFootballMatchGrade({ fixture: row, subjectIsHome: true, scoreChoice: 'regular_time' })).toMatchObject({
        kind: 'void',
        fixtureId: 867946,
      })
    }
  })

  it('returns missing when the finished score is absent — fallback to manual', () => {
    const row = parseApiFootballFixtures({
      response: [
        {
          ...FIXTURE_FT,
          goals: { home: null, away: null },
          score: { fulltime: { home: null, away: null }, extratime: { home: null, away: null }, penalty: { home: null, away: null } },
        },
      ],
    })[0]!
    expect(decideFootballMatchGrade({ fixture: row, subjectIsHome: true, scoreChoice: 'regular_time' }).kind).toBe('missing')
    expect(decideFootballMatchGrade({ fixture: null, subjectIsHome: true, scoreChoice: 'regular_time' })).toEqual({
      kind: 'missing',
      reason: 'API-Football fixture not found',
    })
  })
})

describe('football packet facts', () => {
  it('prints standings, form, H2H, injuries, lineups, stats and both sides; no odds', () => {
    const fixture = parseApiFootballFixtures({ response: [FIXTURE_FT] })[0]!
    const standings = parseApiFootballStandings({
      response: [
        {
          league: {
            standings: [
              [
                {
                  rank: 1,
                  team: { id: 2766, name: 'Jeonbuk Motors' },
                  points: 28,
                  form: 'WWWDW',
                  all: { played: 12, win: 9, draw: 1, lose: 2, goals: { for: 22, against: 10 } },
                  home: { played: 6, win: 5, draw: 0, lose: 1 },
                  away: { played: 6, win: 4, draw: 1, lose: 1 },
                },
                {
                  rank: 4,
                  team: { id: 2763, name: 'Ulsan HD' },
                  points: 20,
                  form: 'DLWWD',
                  all: { played: 12, win: 6, draw: 2, lose: 4, goals: { for: 18, against: 14 } },
                  home: { played: 6, win: 4, draw: 1, lose: 1 },
                  away: { played: 6, win: 2, draw: 1, lose: 3 },
                },
              ],
            ],
          },
        },
      ],
    })
    const injuries = parseApiFootballInjuries({
      response: [{ player: { name: 'Kim' }, team: { id: 2763, name: 'Ulsan HD' }, type: 'Missing Fixture', reason: 'Knee' }],
    })
    const facts = footballFactsFromParts({
      fixture,
      standings,
      h2h: [fixture],
      injuries,
      lineups: {
        confidence: 'projected',
        immutable: false,
        provider: 'api_sports',
        fixtureId: 867946,
        fetchedAt: '2026-10-05T00:00:00.000Z',
        teams: [],
        unavailable: 'API-Sports returned no lineup rows',
      },
      homeStats: parseApiFootballTeamStatistics(
        { response: { team: { id: 2763, name: 'Ulsan HD' }, fixtures: { played: { total: 12 } }, goals: { for: { average: { total: 1.5 } }, against: { average: { total: 1.17 } } }, form: 'DLWWD' } },
        { id: 2763, name: 'Ulsan HD' },
      ),
      awayStats: null,
    })
    const text = formatFootballMatchFacts(facts).join('\n')
    expect(text).toContain('FOOTBALL MATCH FACTS')
    expect(text).toContain('Jeonbuk Motors')
    expect(text).toContain('last 5')
    expect(text).toContain('home record')
    expect(text).toContain('Knee')
    expect(text).toContain('GF/game 1.50')
    expect(text).toContain('BOTH SIDES')
    expect(text).toContain('Up (Ulsan HD)')
    expect(text).toContain('Down (Jeonbuk Motors)')
    expect(text).not.toMatch(/Pinnacle|DraftKings|decimalOdds|bookmaker odds [0-9]|winner_percent/i)
    expect(text).toContain('not in this packet')
    expect(formatFootballMatchFacts(null).join('\n')).toContain('none measured')
    expect(formatFootballMatchFacts(null).join('\n')).not.toContain('1.82')
  })
})
