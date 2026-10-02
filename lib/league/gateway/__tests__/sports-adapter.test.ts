import { describe, expect, it } from 'vitest'
import { createSportsAdapter } from '../adapters/sports'
import {
  decodeSportsInstrument,
  encodeSportsInstrument,
  extractSportsMentions,
  SPORTS_RESOLVES_AFTER_KICKOFF_MS,
} from '../adapters/sports-catalog'
import { formatSportsProposition } from '../adapters/sports-compose'
import { assembleSportsInjection, sportsSearchQueries, subjectImpliedPct } from '../adapters/sports-packet'
import { detectBettingFraming } from '../betting-framing'
import { gradePlanFor } from '../grade-plan'
import { CATEGORY_PROPOSITION_KIND } from '../normalize-prompt'
import { refusalMessageForKey } from '../refusal-copy'
import type { SportsFixtureCacheRow } from '../../sports/types'
import type { NormalizeSlots } from '../types'
import type { SportsPacketIo } from '../adapters/sports-packet'

const KICKOFF = '2026-10-04T14:00:00.000Z'
const KICKOFF_MS = Date.parse(KICKOFF)

const SLATE = [
  {
    fixture_id: 'evt-ars-tot',
    league: 'soccer_epl',
    home: 'Arsenal',
    away: 'Tottenham Hotspur',
    kickoff: KICKOFF,
  },
  {
    fixture_id: 'evt-lad-nyy',
    league: 'baseball_mlb',
    home: 'Los Angeles Dodgers',
    away: 'New York Yankees',
    kickoff: '2026-10-05T00:10:00.000Z',
  },
]

const DEAD_IO: SportsPacketIo = {
  listUpcomingFixtures: async () => {
    throw new Error('io must not be called')
  },
  readFixture: async () => {
    throw new Error('io must not be called')
  },
  fetchFixtureStats: async () => {
    throw new Error('io must not be called')
  },
  getResearchPacket: async () => {
    throw new Error('io must not be called')
  },
}

const SLATE_IO: SportsPacketIo = {
  ...DEAD_IO,
  listUpcomingFixtures: async () => SLATE,
}

const adapter = createSportsAdapter(SLATE_IO, () => new Date('2026-09-27T00:00:00.000Z'))

function slotsFor(instrument: string): NormalizeSlots {
  return adapter.slotsForRound({
    proposition_text: '',
    category: 'sports',
    instrument,
    horizon: '1d',
    resolution_rule: '',
    resolves_at: new Date(KICKOFF_MS + SPORTS_RESOLVES_AFTER_KICKOFF_MS).toISOString(),
  })
}

describe('sports CategoryAdapter', () => {
  it('maps sports → binary_subject_outcome in the normalizer contract', () => {
    expect(CATEGORY_PROPOSITION_KIND.sports).toBe('binary_subject_outcome')
  })

  it('refuses betting framing (국민체육진흥법) and does not open a fixture', async () => {
    expect(detectBettingFraming('손흥민 토토 픽')).toBe(true)
    expect(detectBettingFraming('아스날 핸디캡 오버언더')).toBe(true)
    expect(detectBettingFraming('손흥민 다음 경기')).toBe(false)
    const hit = await adapter.resolveEntity('손흥민 토토', 'ko')
    expect(hit.ok).toBe(false)
    if (!hit.ok && 'refuse' in hit) {
      expect(hit.refuse.code).toBe('betting_framing')
      expect(hit.refuse.message_i18n_key).toBeTruthy()
      expect(refusalMessageForKey(hit.refuse.message_i18n_key, 'ko')).toMatch(/베팅|도박/)
    }
  })

  it('resolves an athlete to the club’s next slate fixture', async () => {
    const hit = await adapter.resolveEntity('손흥민 다음 경기', 'ko')
    expect(hit.ok).toBe(true)
    if (!hit.ok) return
    const parts = decodeSportsInstrument(hit.entity_id)
    expect(parts?.away).toBe('Tottenham Hotspur')
    expect(parts?.side).toBe('away')
    expect(hit.label).toBe('Tottenham Hotspur')
  })

  it('opens the named matchup with the first-mentioned team as Yes', async () => {
    const hit = await adapter.resolveEntity('토트넘 아스날', 'ko')
    expect(hit.ok).toBe(true)
    if (!hit.ok) return
    const parts = decodeSportsInstrument(hit.entity_id)
    expect(parts?.away).toBe('Tottenham Hotspur')
    expect(parts?.side).toBe('away')
    expect(hit.skip_confirm).toBe(true)
    expect(hit.label).toBe('Tottenham Hotspur')
  })

  it('refuses vague input and a past date with the sports guidance copy', async () => {
    const vague = await adapter.resolveEntity('손흥민 이길까', 'ko')
    expect(vague.ok).toBe(false)
    if (!vague.ok && 'refuse' in vague) {
      expect(vague.refuse.code).toBe('vague_target')
      expect(refusalMessageForKey(vague.refuse.message_i18n_key, 'ko')).toBe(
        '팀 이름과 상대 팀을 함께 입력해주세요. 예: 토트넘 아스날 / 양키스 레드삭스',
      )
    }
    const today = await adapter.resolveEntity('오늘 경기', 'ko')
    expect(today.ok).toBe(false)
    if (!today.ok && 'refuse' in today) expect(today.refuse.code).toBe('vague_target')
    const past = await adapter.resolveEntity('토트넘 아스날 3월 10일', 'ko')
    expect(past.ok).toBe(false)
    if (!past.ok && 'refuse' in past) {
      expect(past.refuse.code).toBe('past_event')
      expect(refusalMessageForKey(past.refuse.message_i18n_key, 'ko')).toBe('예측은 앞으로 열릴 경기만 가능합니다.')
    }
  })

  it('refuses when the named club is not on the public slate', async () => {
    const hit = await adapter.resolveEntity('이강인 다음 경기', 'ko')
    expect(hit.ok).toBe(false)
    if (!hit.ok && 'refuse' in hit) {
      expect(hit.refuse.code).toBe('non_public_fixture')
      expect(refusalMessageForKey(hit.refuse.message_i18n_key, 'ko')).toMatch(/지원 범위/)
    }
  })

  it('composes a 90-minute win / draw=No proposition with zero user substrings', async () => {
    const resolved = await adapter.resolveEntity('아스날', 'ko')
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const slots = slotsFor(resolved.entity_id)
    expect(adapter.isDecidable(slots)).toBe(true)
    const round = adapter.composeProposition(slots, new Date('2026-09-27T00:00:00.000Z'))
    expect(round.proposition_kind).toBe('binary_subject_outcome')
    expect(round.observation_shape).toBe('name_match')
    expect(round.subject_label).toBe('Arsenal')
    expect(round.proposition_text).toContain('90 minutes')
    expect(round.proposition_text).toMatch(/draw is No/i)
    expect(round.proposition_text).not.toMatch(/아스날|손흥민|토토|배당|핸디캡|픽/)
    expect(round.resolution_rule).toMatch(/regular time/)
    expect(Date.parse(round.resolves_at)).toBe(KICKOFF_MS + SPORTS_RESOLVES_AFTER_KICKOFF_MS)
    const parts = decodeSportsInstrument(round.instrument)!
    expect(formatSportsProposition(parts)).toBe(round.proposition_text)
  })

  it('parks sports rounds on the operator_manual / needs_grading ladder', () => {
    const instrument = encodeSportsInstrument({
      league: 'soccer_epl',
      eventId: 'evt-ars-tot',
      side: 'home',
      kickoffMs: KICKOFF_MS,
      home: 'Arsenal',
      away: 'Tottenham Hotspur',
    })
    const sources = adapter.gradeSources(slotsFor(instrument))
    expect(sources[0]).toEqual({ tier: 1, kind: 'perplexity_sourced', require_url: true })
    expect(sources[2]).toEqual({ tier: 3, kind: 'operator_manual', require_url: true })
    expect(gradePlanFor(adapter, instrument)).toEqual({ source: 'operator_manual' })
  })
})

describe('sports packet assembly', () => {
  it('anchors on Shin-devigged Pinnacle, tags search lineups, pulls cache stats', () => {
    const parts = decodeSportsInstrument(
      encodeSportsInstrument({
        league: 'soccer_epl',
        eventId: 'evt-ars-tot',
        side: 'home',
        kickoffMs: KICKOFF_MS,
        home: 'Arsenal',
        away: 'Tottenham Hotspur',
      }),
    )!
    const queries = sportsSearchQueries(parts)
    expect(queries.length).toBeGreaterThanOrEqual(4)
    expect(queries.length).toBeLessThanOrEqual(8)
    expect(queries.some((q) => /home advantage rest days/.test(q.q))).toBe(true)
    expect(queries.some((q) => /bullpen workload/.test(q.q))).toBe(true)
    expect(queries.some((q) => /예상 선발 부상자/.test(q.q))).toBe(true)
    expect(queries.some((q) => /head-to-head/.test(q.q))).toBe(true)

    const cache: SportsFixtureCacheRow = {
      fixture_id: 'evt-ars-tot',
      league: 'soccer_epl',
      teams: { home: 'Arsenal', away: 'Tottenham Hotspur' },
      kickoff: KICKOFF,
      devigged_odds: {
        method: 'shin',
        bookKey: 'pinnacle',
        bookTitle: 'Pinnacle',
        bookClass: 'sharp',
        booksum: 1.058,
        overroundPct: 5.82,
        shinZ: 0.03,
        outcomes: [
          { name: 'Arsenal', decimalOdds: 1.38, rawImplied: 0.725, probability: 0.7 },
          { name: 'Tottenham Hotspur', decimalOdds: 7.65, rawImplied: 0.131, probability: 0.115 },
          { name: 'Draw', decimalOdds: 4.93, rawImplied: 0.203, probability: 0.185 },
        ],
        limitation: null,
      },
      lineups: null,
      stats: {
        sport: 'football',
        fetchedAt: '2026-09-27T00:00:00.000Z',
        football: {
          home: { team: 'Arsenal', matches: 5, xg: 9.41, xga: 5.45, xgd: 3.96, xpts: 10 },
          away: { team: 'Tottenham', matches: 5, xg: 7.2, xga: 6.4, xgd: 0.8, xpts: 7 },
          source: 'understat',
        },
        unavailable: null,
      },
      fetched_at: '2026-09-27T00:00:00.000Z',
      ttl: '2026-09-27T05:00:00.000Z',
    }
    expect(subjectImpliedPct(cache.devigged_odds, 'Arsenal')).toBe(70)

    const injection = assembleSportsInjection({
      round: {
        proposition_text: 'Will Arsenal win the Premier League match against Tottenham Hotspur in regular time (90 minutes plus stoppage; a draw is No)?',
        category: 'sports',
        instrument: encodeSportsInstrument(parts),
        horizon: '1w',
        resolution_rule: 'official',
        resolves_at: new Date(KICKOFF_MS + SPORTS_RESOLVES_AFTER_KICKOFF_MS).toISOString(),
      },
      parts,
      cache,
      stats: cache.stats,
      research: {
        available: true,
        cached: false,
        cacheKey: 'k',
        queries: queries.map((q) => q.q),
        findings: [
          { query: 'Arsenal 예상 선발 부상자', summary: 'Projected XI: Raya; Saka doubtful.' },
          { query: 'head-to-head recent form', summary: 'Arsenal unbeaten in last five H2H.' },
        ],
        costUsd: 0.04,
        tier: 'high',
      },
    })
    expect(injection).toContain('MARKET BASELINE')
    expect(injection).toContain('not a required vote')
    expect(injection).toContain('BOTH SIDES')
    expect(injection).toContain('Underdog live chance: Tottenham Hotspur is still priced at 11.5%')
    expect(injection).toContain('Home advantage in this single game belongs to Arsenal')
    expect(injection).not.toMatch(/Pinnacle|DraftKings|FanDuel|Bet365|bookTitle|Book:/)
    expect(injection).toContain('70.0%')
    expect(injection).toMatch(/MARKET BASELINE/i)
    expect(injection).toContain('xG')
    expect(injection).toContain('[projected]')
    expect(injection).not.toMatch(/토토|배당|핸디캡|픽|베팅/)
  })

  it('adds a confirmed-pitcher search for MLB', () => {
    const parts = decodeSportsInstrument(
      encodeSportsInstrument({
        league: 'baseball_mlb',
        eventId: 'evt-lad-nyy',
        side: 'home',
        kickoffMs: Date.parse('2026-10-05T00:10:00.000Z'),
        home: 'Los Angeles Dodgers',
        away: 'New York Yankees',
      }),
    )!
    const q = sportsSearchQueries(parts)
    expect(q.some((row) => /starting pitcher/.test(row.q))).toBe(true)
    expect(q.length).toBe(8)
  })
})

describe('sports mentions', () => {
  it('maps 손흥민 and 토트넘 onto the same club', () => {
    expect(extractSportsMentions('손흥민 다음 경기').map((m) => m.canonical)).toEqual(['Tottenham Hotspur'])
    expect(extractSportsMentions('토트넘 아스날').map((m) => m.canonical)).toEqual([
      'Tottenham Hotspur',
      'Arsenal',
    ])
    expect(extractSportsMentions('아스날 토트넘').map((m) => m.canonical)).toEqual([
      'Arsenal',
      'Tottenham Hotspur',
    ])
  })
})

describe('sports instrument display', () => {
  it('decodes MATCH:... instruments for human display', () => {
    const parts = {
      league: 'baseball_mlb' as const,
      eventId: '12345',
      side: 'away' as const,
      kickoffMs: 1790535960000,
      home: 'San Francisco Giants',
      away: 'Los Angeles Dodgers',
    }
    const inst = encodeSportsInstrument(parts)
    const decoded = decodeSportsInstrument(inst)
    expect(decoded).not.toBeNull()
    expect(decoded?.home).toBe('San Francisco Giants')
    expect(decoded?.away).toBe('Los Angeles Dodgers')
  })
})
