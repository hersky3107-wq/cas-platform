import { describe, expect, it } from 'vitest'
import { createSportsAdapter } from '../adapters/sports'
import {
  decodeSportsInstrument,
  encodeSportsInstrument,
  extractSportsMentions,
  FOOTBALL_RESOLVES_AFTER_KICKOFF_MS,
  SPORTS_RESOLVES_AFTER_KICKOFF_MS,
} from '../adapters/sports-catalog'
import { formatSportsProposition } from '../adapters/sports-compose'
import { assembleSportsInjection, sportsSearchQueries, subjectImpliedPct } from '../adapters/sports-packet'
import { detectBettingFraming } from '../betting-framing'
import { gradePlanFor } from '../grade-plan'
import { CATEGORY_PROPOSITION_KIND } from '../normalize-prompt'
import { refusalMessageForKey } from '../refusal-copy'
import { LEAGUE_LOCALES } from '../../i18n/locales'
import { getLeagueUiPack } from '../../i18n/dictionary'
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
      expect(refusalMessageForKey(hit.refuse.message_i18n_key, 'ko')).toMatch(/K리그|MLB|NBA|UFC/)
      expect(refusalMessageForKey(hit.refuse.message_i18n_key, 'ko')).not.toMatch(/EPL·챔스·라리가·세리에/)
    }
  })

  it('opens K League / J League / Bundesliga next-fixture prompts via API-Football', async () => {
    const footballAdapter = createSportsAdapter(
      {
        ...SLATE_IO,
        searchFootballFixtures: async (query) => {
          if (/울산|케이리그|k리그/i.test(query) && !/전북|포항/.test(query)) {
            return [
              {
                fixture_id: 'af-1001',
                league: 'soccer_korea_kleague1',
                home: 'Ulsan HD',
                away: 'FC Seoul',
                kickoff: '2026-10-06T06:00:00.000Z',
              },
            ]
          }
          if (/전북|포항/.test(query)) {
            return [
              {
                fixture_id: 'af-1002',
                league: 'soccer_korea_kleague1',
                home: 'Jeonbuk Motors',
                away: 'Pohang Steelers',
                kickoff: '2026-10-07T06:00:00.000Z',
              },
            ]
          }
          if (/가시마|j리그|제이리그/i.test(query)) {
            return [
              {
                fixture_id: 'af-2001',
                league: 'soccer_japan_j_league',
                home: 'Kashima Antlers',
                away: 'Urawa',
                kickoff: '2026-10-08T10:00:00.000Z',
              },
            ]
          }
          if (/바이에른|분데스/i.test(query)) {
            return [
              {
                fixture_id: 'af-3001',
                league: 'soccer_germany_bundesliga',
                home: 'Bayern Munich',
                away: 'Borussia Dortmund',
                kickoff: '2026-10-09T18:30:00.000Z',
              },
            ]
          }
          return []
        },
      },
      () => new Date('2026-09-27T00:00:00.000Z'),
    )

    const ulsan = await footballAdapter.resolveEntity('케이리그 울산 다음 경기 이길까?', 'ko')
    expect(ulsan.ok).toBe(true)
    if (ulsan.ok) {
      const parts = decodeSportsInstrument(ulsan.entity_id)
      expect(parts?.home).toBe('Ulsan HD')
      expect(parts?.league).toBe('soccer_korea_kleague1')
      expect(parts?.side).toBe('home')
    }

    const jeonbuk = await footballAdapter.resolveEntity('K리그 전북 vs 포항', 'ko')
    expect(jeonbuk.ok).toBe(true)
    if (jeonbuk.ok) {
      const parts = decodeSportsInstrument(jeonbuk.entity_id)
      expect(parts?.home).toBe('Jeonbuk Motors')
      expect(parts?.away).toBe('Pohang Steelers')
      expect(parts?.side).toBe('home')
    }

    const kashima = await footballAdapter.resolveEntity('J리그 가시마 다음 경기', 'ko')
    expect(kashima.ok).toBe(true)
    if (kashima.ok) {
      expect(decodeSportsInstrument(kashima.entity_id)?.home).toBe('Kashima Antlers')
    }

    const bayern = await footballAdapter.resolveEntity('분데스리가 바이에른 다음 경기', 'ko')
    expect(bayern.ok).toBe(true)
    if (bayern.ok) {
      expect(decodeSportsInstrument(bayern.entity_id)?.home).toBe('Bayern Munich')
      expect(decodeSportsInstrument(bayern.entity_id)?.league).toBe('soccer_germany_bundesliga')
    }
  })

  it('refuses lower-tier football and keeps baseball/basketball on the Odds slate', async () => {
    const footballAdapter = createSportsAdapter(
      {
        ...SLATE_IO,
        searchFootballFixtures: async () => [
          {
            fixture_id: 'af-k3',
            league: 'soccer_k3_league',
            home: 'Ulsan Citizen',
            away: 'Paju Citizen',
            kickoff: '2026-10-06T06:00:00.000Z',
          },
        ],
      },
      () => new Date('2026-09-27T00:00:00.000Z'),
    )
    const amateur = await footballAdapter.resolveEntity('K3리그 울산시티즌 다음 경기', 'ko')
    expect(amateur.ok).toBe(false)
    if (!amateur.ok && 'refuse' in amateur) expect(amateur.refuse.code).toBe('non_public_fixture')

    const mlb = await adapter.resolveEntity('양키스 다저스', 'ko')
    expect(mlb.ok).toBe(true)
    if (mlb.ok) expect(decodeSportsInstrument(mlb.entity_id)?.league).toBe('baseball_mlb')

    const nbaSlate = createSportsAdapter(
      {
        ...DEAD_IO,
        listUpcomingFixtures: async () => [
          ...SLATE,
          {
            fixture_id: 'evt-lal-bos',
            league: 'basketball_nba',
            home: 'Los Angeles Lakers',
            away: 'Boston Celtics',
            kickoff: '2026-10-06T02:00:00.000Z',
          },
        ],
      },
      () => new Date('2026-09-27T00:00:00.000Z'),
    )
    const nba = await nbaSlate.resolveEntity('레이커스 셀틱스', 'ko')
    expect(nba.ok).toBe(true)
    if (nba.ok) expect(decodeSportsInstrument(nba.entity_id)?.league).toBe('basketball_nba')
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
    expect(Date.parse(round.resolves_at)).toBe(KICKOFF_MS + FOOTBALL_RESOLVES_AFTER_KICKOFF_MS)
    const parts = decodeSportsInstrument(round.instrument)!
    expect(formatSportsProposition(parts)).toBe(round.proposition_text)
  })

  it('grades football MATCH via API-Football and parks other sports on operator_manual', () => {
    const soccer = encodeSportsInstrument({
      league: 'soccer_epl',
      eventId: 'evt-ars-tot',
      side: 'home',
      kickoffMs: KICKOFF_MS,
      home: 'Arsenal',
      away: 'Tottenham Hotspur',
    })
    const soccerSources = adapter.gradeSources(slotsFor(soccer))
    expect(soccerSources[0]).toEqual({ tier: 1, kind: 'official_api', endpoint: 'api-football:fixture' })
    expect(soccerSources[2]).toEqual({ tier: 3, kind: 'operator_manual', require_url: true })
    expect(gradePlanFor(adapter, soccer)).toEqual({
      source: 'api_football',
      tier1: { tier: 1, kind: 'official_api', endpoint: 'api-football:fixture' },
    })

    const mlb = encodeSportsInstrument({
      league: 'baseball_mlb',
      eventId: 'evt-lad-nyy',
      side: 'home',
      kickoffMs: Date.parse('2026-10-05T00:10:00.000Z'),
      home: 'Los Angeles Dodgers',
      away: 'New York Yankees',
    })
    expect(adapter.gradeSources(slotsFor(mlb))[0]).toEqual({
      tier: 1,
      kind: 'perplexity_sourced',
      require_url: true,
    })
    expect(gradePlanFor(adapter, mlb)).toEqual({ source: 'operator_manual' })
  })

  it('uses API-Football as the primary football slate for Korean club names', async () => {
    const footballAdapter = createSportsAdapter(
      {
        ...SLATE_IO,
        searchFootballFixtures: async () => [
          {
            fixture_id: 'af-867946',
            league: 'soccer_korea_kleague1',
            home: 'Ulsan HD',
            away: 'Jeonbuk Motors',
            kickoff: '2026-10-06T06:00:00.000Z',
          },
        ],
      },
      () => new Date('2026-09-27T00:00:00.000Z'),
    )
    const hit = await footballAdapter.resolveEntity('울산 전북', 'ko')
    expect(hit.ok).toBe(true)
    if (!hit.ok) return
    const parts = decodeSportsInstrument(hit.entity_id)
    expect(parts?.league).toBe('soccer_korea_kleague1')
    expect(parts?.home).toBe('Ulsan HD')
    expect(parts?.away).toBe('Jeonbuk Motors')
    expect(parts?.side).toBe('home')
    expect(hit.skip_confirm).toBe(true)
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
    expect(injection).toContain('FOOTBALL MATCH FACTS')
    expect(injection).toContain('BOTH SIDES')
    expect(injection).toContain('none measured')
    expect(injection).toContain('[projected]')
    expect(injection).not.toMatch(/MARKET BASELINE|Pinnacle|DraftKings|FanDuel|Bet365|bookTitle|Book:|decimalOdds/i)
    expect(injection).not.toContain('70.0%')
    expect(injection).not.toMatch(/토토|배당|핸디캡|픽|베팅/)
  })

  it('keeps bookmaker odds in the MLB official packet (non-football)', () => {
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
    const injection = assembleSportsInjection({
      round: {
        proposition_text: 'Will the Los Angeles Dodgers win the MLB game against the New York Yankees?',
        category: 'sports',
        instrument: encodeSportsInstrument(parts),
        horizon: '1w',
        resolution_rule: 'official',
        resolves_at: new Date(Date.parse('2026-10-05T00:10:00.000Z') + SPORTS_RESOLVES_AFTER_KICKOFF_MS).toISOString(),
      },
      parts,
      cache: {
        fixture_id: 'evt-lad-nyy',
        league: 'baseball_mlb',
        teams: { home: 'Los Angeles Dodgers', away: 'New York Yankees' },
        kickoff: '2026-10-05T00:10:00.000Z',
        devigged_odds: {
          method: 'shin',
          bookKey: 'pinnacle',
          bookTitle: 'Pinnacle',
          bookClass: 'sharp',
          booksum: 1.04,
          overroundPct: 4,
          shinZ: 0.02,
          outcomes: [
            { name: 'Los Angeles Dodgers', decimalOdds: 1.7, rawImplied: 0.588, probability: 0.56 },
            { name: 'New York Yankees', decimalOdds: 2.2, rawImplied: 0.455, probability: 0.44 },
          ],
          limitation: null,
        },
        lineups: null,
        stats: null,
        fetched_at: '2026-09-27T00:00:00.000Z',
        ttl: '2026-09-27T05:00:00.000Z',
      },
      stats: null,
      research: {
        available: false,
        cached: false,
        cacheKey: 'k',
        queries: [],
        findings: [],
        costUsd: 0,
        tier: 'high',
      },
    })
    expect(injection).toContain('MARKET BASELINE')
    expect(injection).toContain('56.0%')
    expect(injection).not.toMatch(/Pinnacle|DraftKings|bookTitle/)
    expect(injection).not.toContain('FOOTBALL MATCH FACTS')
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
    expect(extractSportsMentions('케이리그 울산 다음 경기').map((m) => m.canonical)).toEqual(['Ulsan HD'])
    expect(extractSportsMentions('전북 현대 포항 스틸러스').map((m) => m.canonical)).toEqual([
      'Jeonbuk Motors',
      'Pohang Steelers',
    ])
  })
})

describe('sports scope copy', () => {
  it('lists the real per-sport scope in all 8 locales and drops the stale EPL-only list', () => {
    for (const locale of LEAGUE_LOCALES) {
      const msg = refusalMessageForKey('league.gateway.refusal.non_public_fixture', locale)
      expect(msg.length).toBeGreaterThan(20)
      expect(msg).not.toMatch(/EPL·챔스·라리가·세리에/)
      expect(msg.toLowerCase()).toMatch(/mlb/)
      expect(msg.toLowerCase()).toMatch(/nba/)
    }
    expect(getLeagueUiPack('ko').catalog.freeformPanel.sports.examples).toEqual([
      '토트넘이 아스날을 이길까?',
      '양키스가 레드삭스를 이길까?',
      '울산이 다음 경기에서 이길까?',
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
