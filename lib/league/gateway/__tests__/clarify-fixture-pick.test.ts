import { describe, expect, it, vi } from 'vitest'
import { parseAnsweredSlots } from '../answered-slots'
import { nextClarifySubmission } from '../clarify-answer'
import { createSportsAdapter } from '../adapters/sports'
import { decodeSportsInstrument, encodeSportsInstrument } from '../adapters/sports-catalog'
import type { SportsPacketIo } from '../adapters/sports-packet'
import { runLeagueGateway, type GatewayDeps, type GatewayRequest } from '../shell'
import type { GatewayViewer } from '../types'

const NOW = new Date('2026-09-26T12:00:00.000Z')
const EVENT = 'a'.repeat(32)

const YANKEES_SLATE = [
  {
    fixture_id: EVENT,
    league: 'baseball_mlb',
    home: 'Baltimore Orioles',
    away: 'New York Yankees',
    kickoff: '2026-09-27T23:00:00.000Z',
  },
  {
    fixture_id: `${EVENT}b`,
    league: 'baseball_mlb',
    home: 'Boston Red Sox',
    away: 'New York Yankees',
    kickoff: '2026-09-29T23:00:00.000Z',
  },
]

const DODGERS_SLATE = [
  {
    fixture_id: 'dodgers-one',
    league: 'baseball_mlb',
    home: 'San Francisco Giants',
    away: 'Los Angeles Dodgers',
    kickoff: '2026-09-28T02:00:00.000Z',
  },
]

const US: GatewayViewer = {
  userId: 'user-1',
  isAdmin: false,
  jurisdiction: { declaredCountry: 'US', ipCountry: 'US' },
}

type SlateRow = {
  fixture_id: string
  league: string
  home: string
  away: string
  kickoff: string
}

function io(slate: readonly SlateRow[]): SportsPacketIo {
  return {
    listUpcomingFixtures: async () => [...slate],
    readFixture: async () => null,
    fetchFixtureStats: async () => null,
    getResearchPacket: async () => {
      throw new Error('research must not run during clarify')
    },
  }
}

function deps(slate: readonly SlateRow[], charge: ReturnType<typeof vi.fn>): GatewayDeps {
  return {
    adapterFor: (id) => (id === 'sports' ? createSportsAdapter(io(slate), () => NOW) : null),
    normalizer: {
      normalize: async () => ({
        category_id: 'sports',
        entity_mention: '양키스',
        entity_id_hint: null,
        horizon: '1w',
        proposition_kind: 'binary_subject_outcome',
        slots: {},
        confidence: 0.92,
        needs_slot: null,
      }),
    },
    deductCredits: charge,
    now: () => NOW,
  }
}

function request(over: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    viewer: US,
    category_id: 'sports',
    raw_text: '뉴욕 양키스 다음경기',
    locale: 'ko',
    ...over,
  }
}

describe('sports multi-fixture clarify reaches generate', () => {
  it('keeps a MATCH instrument intact — the old 80-char clip dropped the away team', () => {
    const instrument = encodeSportsInstrument({
      league: 'baseball_mlb',
      eventId: EVENT,
      side: 'away',
      kickoffMs: Date.parse('2026-09-27T23:00:00.000Z'),
      home: 'Baltimore Orioles',
      away: 'New York Yankees',
    })
    expect(instrument.length).toBeGreaterThan(80)
    expect(decodeSportsInstrument(instrument.slice(0, 80))).toBeNull()
    const parsed = parseAnsweredSlots({ entity_id: instrument, entity_confirmed: 'true' })
    expect(parsed.entity_id).toBe(instrument)
    expect(decodeSportsInstrument(parsed.entity_id!)).not.toBeNull()
  })

  it('a fixture chip confirms the MATCH and does not burn a clarify round; 네, 맞아요 stays a confirm', () => {
    const instrument = encodeSportsInstrument({
      league: 'baseball_mlb',
      eventId: EVENT,
      side: 'away',
      kickoffMs: Date.parse('2026-09-27T23:00:00.000Z'),
      home: 'Baltimore Orioles',
      away: 'New York Yankees',
    })
    const picked = nextClarifySubmission({}, 'entity_id', instrument, 0)
    expect(picked.answered.entity_id).toBe(instrument)
    expect(picked.answered.entity_confirmed).toBe('true')
    expect(picked.clarifyRound).toBe(0)

    const confirm = nextClarifySubmission({ entity_id: 'AAPL' }, 'entity_confirmed', 'true', 1)
    expect(confirm.answered).toEqual({ entity_id: 'AAPL', entity_confirmed: 'true' })
    expect(confirm.clarifyRound).toBe(1)

    const horizon = nextClarifySubmission({}, 'horizon', '1w', 0)
    expect(horizon.answered.entity_confirmed).toBeUndefined()
    expect(horizon.clarifyRound).toBe(1)
  })

  it('clicking one of two Yankees fixtures returns ready for that MATCH and charges once', async () => {
    const charge = vi.fn(async () => ({ ok: true }))
    const first = await runLeagueGateway(request(), deps(YANKEES_SLATE, charge))
    expect(first.status).toBe('clarify')
    if (first.status !== 'clarify') throw new Error('unreachable')
    expect(first.questions[0]?.slot).toBe('entity_id')
    const options = first.questions[0]?.options ?? []
    expect(options).toHaveLength(2)
    expect(options.every((o) => decodeSportsInstrument(o.id))).toBe(true)
    expect(charge).not.toHaveBeenCalled()

    const chosen = options[0]!.id
    const second = await runLeagueGateway(
      request({ answered_slots: { entity_id: chosen }, clarify_round: 1 }),
      deps(YANKEES_SLATE, charge),
    )
    expect(second.status).toBe('ready')
    if (second.status !== 'ready') throw new Error('unreachable')
    expect(second.round.instrument).toBe(chosen)
    expect(second.round.proposition_text).toContain('New York Yankees')
    expect(second.round.proposition_text).toContain('Baltimore Orioles')
    expect(charge).toHaveBeenCalledTimes(1)
  })

  it('a single Dodgers fixture still stops on 네, 맞아요 before it is ready', async () => {
    const charge = vi.fn(async () => ({ ok: true }))
    const gateway = deps(DODGERS_SLATE, charge)
    gateway.normalizer = {
      normalize: async () => ({
        category_id: 'sports',
        entity_mention: '다저스',
        entity_id_hint: null,
        horizon: '1w',
        proposition_kind: 'binary_subject_outcome',
        slots: {},
        confidence: 0.92,
        needs_slot: null,
      }),
    }
    const first = await runLeagueGateway(request({ raw_text: '다저스 다음경기' }), gateway)
    expect(first.status).toBe('clarify')
    if (first.status !== 'clarify') throw new Error('unreachable')
    expect(first.questions[0]?.slot).toBe('entity_confirmed')
    expect(first.preview_proposition).toContain('로스앤젤레스 다저스')
    expect(first.preview_proposition).not.toContain('Will ')
    expect(charge).not.toHaveBeenCalled()

    const second = await runLeagueGateway(
      request({ raw_text: '다저스 다음경기', answered_slots: { entity_confirmed: 'true' } }),
      gateway,
    )
    expect(second.status).toBe('ready')
    if (second.status !== 'ready') throw new Error('unreachable')
    expect(decodeSportsInstrument(second.round.instrument)?.away).toBe('Los Angeles Dodgers')
    expect(charge).toHaveBeenCalledTimes(1)
  })

  it('team + opponent on the slate opens the round without a browse list or which-Yes chips', async () => {
    const charge = vi.fn(async () => ({ ok: true }))
    const slate = [
      {
        fixture_id: 'epl-ars-tot',
        league: 'soccer_epl',
        home: 'Arsenal',
        away: 'Tottenham Hotspur',
        kickoff: '2026-10-04T14:00:00.000Z',
      },
    ]
    const gateway = deps(slate, charge)
    gateway.normalizer = {
      normalize: async () => ({
        category_id: 'sports',
        entity_mention: '토트넘',
        entity_id_hint: null,
        horizon: '1w',
        proposition_kind: 'binary_subject_outcome',
        slots: {},
        confidence: 0.92,
        needs_slot: null,
      }),
    }
    const result = await runLeagueGateway(request({ raw_text: '토트넘 아스날' }), gateway)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('unreachable')
    const parts = decodeSportsInstrument(result.round.instrument)
    expect(parts?.side).toBe('away')
    expect(parts?.away).toBe('Tottenham Hotspur')
    expect(result.round.proposition_text).toContain('Tottenham Hotspur')
    expect(charge).toHaveBeenCalledTimes(1)
  })
})
