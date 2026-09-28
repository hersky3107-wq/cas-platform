import { describe, expect, it } from 'vitest'
import { decodeSportsInstrument, extractSportsMentions } from '../adapters/sports-catalog'
import {
  parseSportsSearchDate,
  resolveSportsTarget,
  upcomingInWindow,
} from '../adapters/sports-target'
import { MAX_TARGET_PICKS, TARGET_WINDOW_MS, targetRefusalCode } from '../target-resolve'
import type { SportsFixtureLite } from '../adapters/sports-catalog'

const NOW = new Date('2026-09-28T03:00:00.000Z')

const SLATE: SportsFixtureLite[] = [
  {
    fixture_id: 'epl-ars-tot',
    league: 'soccer_epl',
    home: 'Arsenal',
    away: 'Tottenham Hotspur',
    kickoff: '2026-10-04T14:00:00.000Z',
  },
  {
    fixture_id: 'epl-tot-che',
    league: 'soccer_epl',
    home: 'Tottenham Hotspur',
    away: 'Chelsea',
    kickoff: '2026-10-11T14:00:00.000Z',
  },
  {
    fixture_id: 'mlb-bos-nyy',
    league: 'baseball_mlb',
    home: 'Boston Red Sox',
    away: 'New York Yankees',
    kickoff: '2026-10-10T23:10:00.000Z',
  },
  {
    fixture_id: 'nl-fra-ger',
    league: 'soccer_uefa_nations_league',
    home: 'France',
    away: 'Germany',
    kickoff: '2026-10-14T18:45:00.000Z',
  },
  {
    fixture_id: 'past-ars-tot',
    league: 'soccer_epl',
    home: 'Tottenham Hotspur',
    away: 'Arsenal',
    kickoff: '2026-03-10T15:00:00.000Z',
  },
]

describe('generic target search contract', () => {
  it('keeps a ~month window and maps miss kinds onto sports refusal codes', () => {
    expect(TARGET_WINDOW_MS).toBe(35 * 86_400_000)
    expect(MAX_TARGET_PICKS).toBe(12)
    expect(targetRefusalCode('vague')).toBe('vague_target')
    expect(targetRefusalCode('past')).toBe('past_event')
    expect(targetRefusalCode('unsupported')).toBe('non_public_fixture')
  })
})

describe('sports search resolution', () => {
  it('keeps first-mentioned team as the Yes subject for team + opponent', () => {
    expect(extractSportsMentions('아스날 토트넘').map((m) => m.canonical)).toEqual([
      'Arsenal',
      'Tottenham Hotspur',
    ])
    const hit = resolveSportsTarget('토트넘 아스날', SLATE, NOW)
    expect(hit.kind).toBe('ready')
    if (hit.kind !== 'ready') return
    expect(hit.skipConfirm).toBe(true)
    const parts = decodeSportsInstrument(hit.entityId)
    expect(parts?.away).toBe('Tottenham Hotspur')
    expect(parts?.side).toBe('away')
    expect(parts?.home).toBe('Arsenal')
  })

  it('lists that team’s upcoming window as picks when only one side is named', () => {
    const hit = resolveSportsTarget('토트넘', SLATE, NOW)
    expect(hit.kind).toBe('picks')
    if (hit.kind !== 'picks') return
    expect(hit.options).toHaveLength(2)
    expect(hit.options.every((o) => decodeSportsInstrument(o.id))).toBe(true)
  })

  it('pins a dated team+opponent fixture', () => {
    const date = parseSportsSearchDate('토트넘 아스날 10월 4일', NOW)
    expect(date).toEqual({ year: 2026, month: 10, day: 4 })
    const hit = resolveSportsTarget('토트넘 아스날 10월 4일', SLATE, NOW)
    expect(hit.kind).toBe('ready')
    if (hit.kind !== 'ready') return
    expect(decodeSportsInstrument(hit.entityId)?.eventId).toBe('epl-ars-tot')
  })

  it('maps 손흥민 onto Tottenham’s schedule, but refuses a player prediction with no matchup', () => {
    const schedule = resolveSportsTarget('손흥민', SLATE, NOW)
    expect(schedule.kind).toBe('picks')
    const vague = resolveSportsTarget('손흥민 이길까', SLATE, NOW)
    expect(vague).toEqual({ kind: 'vague' })
    expect(resolveSportsTarget('오늘 경기', SLATE, NOW)).toEqual({ kind: 'vague' })
  })

  it('refuses a past date and an unsupported club', () => {
    expect(resolveSportsTarget('토트넘 아스날 3월 10일', SLATE, NOW)).toEqual({ kind: 'past' })
    expect(resolveSportsTarget('이강인 다음 경기', SLATE, NOW)).toEqual({ kind: 'unsupported' })
  })

  it('resolves a Nations League pair that is on the slate', () => {
    const hit = resolveSportsTarget('프랑스 독일', SLATE, NOW)
    expect(hit.kind).toBe('ready')
    if (hit.kind !== 'ready') return
    expect(decodeSportsInstrument(hit.entityId)?.league).toBe('soccer_uefa_nations_league')
  })

  it('caps team-alone picks and drops fixtures outside the window', () => {
    const flood: SportsFixtureLite[] = Array.from({ length: 16 }, (_, i) => ({
      fixture_id: `tot-${i}`,
      league: 'soccer_epl',
      home: 'Tottenham Hotspur',
      away: `Club ${i}`,
      kickoff: new Date(NOW.getTime() + (i + 1) * 86_400_000).toISOString(),
    }))
    const far: SportsFixtureLite = {
      fixture_id: 'too-far',
      league: 'soccer_epl',
      home: 'Tottenham Hotspur',
      away: 'Far Away FC',
      kickoff: new Date(NOW.getTime() + TARGET_WINDOW_MS + 86_400_000).toISOString(),
    }
    expect(upcomingInWindow([...flood, far], NOW).some((r) => r.fixture_id === 'too-far')).toBe(false)
    const hit = resolveSportsTarget('토트넘', [...flood, far], NOW)
    expect(hit.kind).toBe('picks')
    if (hit.kind !== 'picks') return
    expect(hit.options).toHaveLength(MAX_TARGET_PICKS)
  })
})
