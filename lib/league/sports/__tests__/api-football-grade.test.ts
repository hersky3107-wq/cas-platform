import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeSportsInstrument } from '../../gateway/adapters/sports-catalog'
import type { ApiFootballFixture } from '../api-football-parse'

vi.mock('server-only', () => ({}))

const fetchFixtureById = vi.fn()
const resolveFixtureIdForParts = vi.fn()

vi.mock('../api-football', () => ({
  fetchFixtureById: (...args: unknown[]) => fetchFixtureById(...args),
  resolveFixtureIdForParts: (...args: unknown[]) => resolveFixtureIdForParts(...args),
}))

const { gradeFootballMatchInstrument } = await import('../api-football-grade')

const KICKOFF_MS = Date.parse('2026-10-04T06:00:00.000Z')

const INSTRUMENT = encodeSportsInstrument({
  league: 'soccer_korea_kleague1',
  eventId: 'af-867946',
  side: 'home',
  kickoffMs: KICKOFF_MS,
  home: 'Ulsan HD',
  away: 'Jeonbuk Motors',
})

function fixture(overrides: Partial<ApiFootballFixture> = {}): ApiFootballFixture {
  return {
    fixtureId: 867946,
    date: '2026-10-04T06:00:00+00:00',
    timestamp: Math.floor(KICKOFF_MS / 1000),
    statusShort: 'FT',
    statusLong: 'Match Finished',
    leagueId: 292,
    leagueName: 'K League 1',
    leagueCountry: 'South-Korea',
    season: 2026,
    round: 'Regular Season - 12',
    home: { id: 2763, name: 'Ulsan HD' },
    away: { id: 2766, name: 'Jeonbuk Motors' },
    goalsHome: 2,
    goalsAway: 1,
    fulltimeHome: 2,
    fulltimeAway: 1,
    extratimeHome: null,
    extratimeAway: null,
    penaltyHome: null,
    penaltyAway: null,
    ...overrides,
  }
}

describe('gradeFootballMatchInstrument', () => {
  beforeEach(() => {
    fetchFixtureById.mockReset()
    resolveFixtureIdForParts.mockReset()
    resolveFixtureIdForParts.mockResolvedValue(867946)
  })

  it('grades a 90-minute win from score.fulltime', async () => {
    fetchFixtureById.mockResolvedValue({ fixture: fixture(), error: null })
    const now = new Date(KICKOFF_MS + 4 * 60 * 60 * 1000)
    const result = await gradeFootballMatchInstrument(
      INSTRUMENT,
      'Will Ulsan HD win ... in regular time (90 minutes plus stoppage; a draw is No)?',
      now,
    )
    expect(result).toMatchObject({
      status: 'resolved',
      outcome: {
        actualDirection: 'up',
        rawOutcome: expect.stringContaining('fixture 867946'),
      },
    })
    if (result && 'outcome' in result && result.status === 'resolved') {
      expect(result.outcome.rawOutcome).toMatch(/^up /)
      expect(result.outcome.rawOutcome).toContain('2-1')
    }
  })

  it('uses the official final (incl. penalties) when the proposition is not 90 minutes', async () => {
    fetchFixtureById.mockResolvedValue({
      fixture: fixture({
        statusShort: 'PEN',
        goalsHome: 2,
        goalsAway: 2,
        fulltimeHome: 1,
        fulltimeAway: 1,
        extratimeHome: 0,
        extratimeAway: 0,
        penaltyHome: 5,
        penaltyAway: 4,
      }),
      error: null,
    })
    const result = await gradeFootballMatchInstrument(INSTRUMENT, 'Will Ulsan HD win the cup tie?', new Date(KICKOFF_MS + 4 * 60 * 60 * 1000))
    expect(result).toMatchObject({ status: 'resolved', outcome: { actualDirection: 'up' } })
    if (result && result.status === 'resolved') {
      expect(result.outcome.rawOutcome).toContain('6-5')
      expect(result.outcome.rawOutcome).toContain('final')
    }
  })

  it('voids postponed fixtures', async () => {
    fetchFixtureById.mockResolvedValue({
      fixture: fixture({ statusShort: 'PST', statusLong: 'Match Postponed', goalsHome: null, goalsAway: null, fulltimeHome: null, fulltimeAway: null }),
      error: null,
    })
    const result = await gradeFootballMatchInstrument(INSTRUMENT, 'Will Ulsan HD win in regular time (90 minutes)?', new Date(KICKOFF_MS + 4 * 60 * 60 * 1000))
    expect(result).toEqual({
      status: 'voided',
      rawOutcome: expect.stringContaining('fixture 867946'),
    })
  })

  it('stays pending when the result is missing inside 48h, then falls back to manual', async () => {
    fetchFixtureById.mockResolvedValue({ fixture: null, error: 'not found' })
    const inside = await gradeFootballMatchInstrument(INSTRUMENT, '', new Date(KICKOFF_MS + 47 * 60 * 60 * 1000))
    expect(inside).toEqual({ status: 'pending', detail: 'API-Football fixture not found' })
    const after = await gradeFootballMatchInstrument(INSTRUMENT, '', new Date(KICKOFF_MS + 48 * 60 * 60 * 1000))
    expect(after).toBeNull()
  })
})
