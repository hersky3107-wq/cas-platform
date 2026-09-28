import { describe, expect, it, vi } from 'vitest'
import { createPoliticsAdapter } from '../adapters/politics'
import type { PoliticsPacketIo } from '../adapters/politics-packet'
import type { ElectionCandidateLite } from '../../politics/markets'
import { runLeagueGateway, type GatewayDeps, type GatewayRequest } from '../shell'
import type { GatewayViewer } from '../types'

const NOW = new Date('2026-09-28T06:00:00.000Z')
const POLL = '2026-11-03T23:00:00.000Z'

const GA_SLATE: ElectionCandidateLite[] = [
  {
    jurisdiction: 'US',
    office: 'governor',
    cycle: '2026',
    district: 'GA',
    candidate: 'Keisha Lance Bottoms',
    pollCloseIso: POLL,
    kalshiPct: 50.5,
    polymarketPct: null,
  },
  {
    jurisdiction: 'US',
    office: 'governor',
    cycle: '2026',
    district: 'GA',
    candidate: 'Rick Jackson',
    pollCloseIso: POLL,
    kalshiPct: 49.5,
    polymarketPct: null,
  },
]

const US: GatewayViewer = {
  userId: 'user-1',
  isAdmin: false,
  jurisdiction: { declaredCountry: 'US', ipCountry: 'US' },
}

function io(slate: readonly ElectionCandidateLite[]): PoliticsPacketIo {
  return {
    listUpcoming: async () => [...slate],
    readBaseline: async () => null,
    readPolls: async () => [],
    getResearchPacket: async () => ({
      available: false,
      cached: false,
      cacheKey: 'x',
      queries: [],
      findings: [],
      costUsd: 0,
      tier: 'low',
    }),
  }
}

function deps(slate: readonly ElectionCandidateLite[], charge: ReturnType<typeof vi.fn>): GatewayDeps {
  return {
    adapterFor: (id) => (id === 'politics_election' ? createPoliticsAdapter(io(slate), () => NOW) : null),
    normalizer: {
      normalize: async () => ({
        category_id: 'politics_election',
        entity_mention: '',
        entity_id_hint: null,
        horizon: null,
        proposition_kind: 'binary_subject_outcome',
        slots: {},
        confidence: 0.35,
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
    category_id: 'politics_election',
    raw_text: '조지아 주지사',
    locale: 'ko',
    ...over,
  }
}

describe('politics gateway — office-only query survives weak normalizer', () => {
  it('returns clarify candidate chips instead of low_confidence when normalizer confidence is low', async () => {
    const charge = vi.fn(async () => ({ ok: true }))
    const result = await runLeagueGateway(request(), deps(GA_SLATE, charge))
    expect(result.status).toBe('clarify')
    if (result.status !== 'clarify') throw new Error('unreachable')
    expect(result.questions[0]?.slot).toBe('entity_id')
    expect(result.questions[0]?.options?.map((o) => o.label)).toEqual([
      'Keisha Lance Bottoms · 2026 미국 조지아 주지사',
      'Rick Jackson · 2026 미국 조지아 주지사',
    ])
    expect(charge).not.toHaveBeenCalled()
  })

  it('refuses vague_election (not low_confidence) when the normalizer fails and the race is unknown', async () => {
    const charge = vi.fn(async () => ({ ok: true }))
    const result = await runLeagueGateway(
      request({ raw_text: '누가 당선될까' }),
      deps([], charge),
    )
    expect(result).toMatchObject({ status: 'refused', refusal: { code: 'vague_election' } })
    expect(charge).not.toHaveBeenCalled()
  })
})
