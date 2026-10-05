import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { buildConsensusInput } from '../extra/consensus'
import {
  acceptMarketPick,
  assembleConsensusMarket,
  consensusMarketEligible,
  finalizeMarketPick,
  mapOutcomeToBrand,
  marketSearchQuery,
  parseMarketPickJson,
  planConsensusAfterMarkets,
  type OpenMarketCandidate,
} from '../extra/market-match'
import { parseKalshiSearch, searchConsensusMarkets } from '../extra/market-search'

const DEADLINE = '2026-10-31T23:59:59.999Z'

function candidate(over: Partial<OpenMarketCandidate> = {}): OpenMarketCandidate {
  return {
    venue: 'kalshi',
    id: 'KXAI-OCT',
    title: 'Best AI model at the end of October?',
    outcome: 'OpenAI',
    impliedYes: 0.69,
    resolvesAt: '2026-10-28T00:00:00.000Z',
    ...over,
  }
}

describe('acceptMarketPick', () => {
  it('accepts relevance 0.7 inside the 7-day window and rejects just under', () => {
    expect(
      acceptMarketPick({
        relevance: 0.7,
        marketResolvesAt: '2026-10-24T23:59:59.999Z',
        deadline: DEADLINE,
        sameEvent: false,
      }),
    ).toBe(true)
    expect(
      acceptMarketPick({
        relevance: 0.699,
        marketResolvesAt: DEADLINE,
        deadline: DEADLINE,
        sameEvent: false,
      }),
    ).toBe(false)
  })

  it('rejects a resolution more than 7 days from the deadline unless it is the same event', () => {
    expect(
      acceptMarketPick({
        relevance: 0.9,
        marketResolvesAt: '2026-11-09T00:00:00.000Z',
        deadline: DEADLINE,
        sameEvent: false,
      }),
    ).toBe(false)
    expect(
      acceptMarketPick({
        relevance: 0.9,
        marketResolvesAt: '2026-12-31T00:00:00.000Z',
        deadline: DEADLINE,
        sameEvent: true,
      }),
    ).toBe(true)
  })
})

describe('brand_table mapping', () => {
  it('searches a best-model market for the deadline month and maps the outcome onto a brand', () => {
    expect(marketSearchQuery({ proposition: 'ignored', deadline: DEADLINE, brandTable: true })).toBe(
      'which company has the best AI model end of October',
    )
    expect(mapOutcomeToBrand('ChatGPT', ['OpenAI', 'Google'])).toBe('OpenAI')
    expect(mapOutcomeToBrand('SomeFund', ['OpenAI', 'Google'])).toBeNull()
    const row = candidate()
    expect(
      finalizeMarketPick({
        pick: { venue: 'kalshi', id: row.id, outcome: 'ChatGPT', relevance: 0.82, sameEvent: false },
        candidate: row,
        deadline: DEADLINE,
        brandTable: true,
        brandCandidates: ['OpenAI', 'Google'],
      })?.brand,
    ).toBe('OpenAI')
    expect(
      finalizeMarketPick({
        pick: { venue: 'kalshi', id: row.id, outcome: 'SomeFund', relevance: 0.9, sameEvent: true },
        candidate: row,
        deadline: DEADLINE,
        brandTable: true,
        brandCandidates: ['OpenAI', 'Google'],
      }),
    ).toBeNull()
  })
})

describe('provider failures', () => {
  it('skips Polymarket on HTTP 451 and does not call another route', async () => {
    const urls: string[] = []
    const logs: string[] = []
    const markets = await searchConsensusMarkets('OpenAI', {
      log: (event) => logs.push(`${event.event}:${event.provider}:${event.status}`),
      fetchImpl: async (url) => {
        const href = String(url)
        urls.push(href)
        if (href.includes('polymarket')) return new Response('unavailable', { status: 451 })
        return new Response(
          JSON.stringify({
            current_page: [
              {
                event_title: 'OpenAI ships',
                markets: [
                  {
                    ticker: 'KXOPEN-1',
                    title: 'Will OpenAI ship?',
                    yes_subtitle: 'Yes',
                    yes_bid_dollars: '0.6600',
                    yes_ask_dollars: '0.7000',
                    last_price_dollars: '0.6900',
                    close_ts: DEADLINE,
                    result: '',
                  },
                  {
                    ticker: 'KXOPEN-OLD',
                    title: 'Settled',
                    yes_subtitle: 'Yes',
                    last_price_dollars: '0.0100',
                    result: 'no',
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    })
    expect(urls).toHaveLength(2)
    expect(urls.filter((u) => u.includes('polymarket'))).toHaveLength(1)
    expect(logs).toEqual(['provider_unavailable:polymarket:451'])
    expect(markets.map((m) => m.id)).toEqual(['KXOPEN-1'])
    expect(markets[0]?.impliedYes).toBe(0.68)
  })

  it('logs timeout and returns no markets', async () => {
    const logs: string[] = []
    const markets = await searchConsensusMarkets('OpenAI', {
      timeoutMs: 30,
      log: (event) => logs.push(`${event.provider}:${event.status}`),
      fetchImpl: (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }),
    })
    expect(markets).toEqual([])
    expect(logs.sort()).toEqual(['kalshi:timeout', 'polymarket:timeout'])
  })
})

describe('consensus seat plan', () => {
  it('uses the market when one is accepted, otherwise search, otherwise abstain', async () => {
    const row = candidate({ impliedYes: 0.69, resolvesAt: DEADLINE })
    const match = await assembleConsensusMarket({
      proposition: 'Will OpenAI ship a new model?',
      deadline: DEADLINE,
      brandTable: false,
      brandCandidates: [],
      search: async () => [row],
      pick: async () => ({ venue: 'kalshi', id: row.id, outcome: 'Yes', relevance: 0.91, sameEvent: false }),
    })
    expect(planConsensusAfterMarkets({ match, search: 'verdict' })).toBe('market')
    expect(match?.venue).toBe('kalshi')
    expect(planConsensusAfterMarkets({ match: null, search: 'verdict' })).toBe('search')
    expect(planConsensusAfterMarkets({ match: null, search: 'abstain' })).toBe('abstain')
    expect(planConsensusAfterMarkets({ match: null, search: 'none' })).toBe('abstain')
  })

  it('keeps official consensus packets free of market odds', () => {
    const input = buildConsensusInput({
      proposition_text: 'Will OpenAI lead?',
      category: 'tech',
      instrument: 'TECH:OPEN:openai:launch:model:20261031:news',
      horizon: '1m',
      subject_label: 'OpenAI',
      proposition_kind: 'binary_subject_outcome',
    })
    expect(Object.keys(input).sort()).toEqual(
      ['category', 'horizon', 'instrument', 'proposition', 'propositionKind', 'subjectName'].sort(),
    )
    expect(JSON.stringify(input)).not.toMatch(/kalshi|polymarket|impliedYes|consensus_source/i)
    const packet = readFileSync('lib/league/ai-ranking/packet.ts', 'utf8')
    expect(packet).not.toMatch(/market-search|searchConsensusMarkets|matchConsensusMarket/)
    expect(consensusMarketEligible('stock', 'AAPL')).toBe(false)
    expect(consensusMarketEligible('tech', 'TECH:OPEN:x')).toBe(true)
    expect(consensusMarketEligible('ai_models', 'AIRANK:text:overall:brand_table:top10:20261031')).toBe(true)
  })
})

describe('parseKalshiSearch', () => {
  it('ignores a pick whose id is not in the candidate list', () => {
    const row = candidate()
    expect(parseMarketPickJson('{"venue":"kalshi","id":"missing","outcome":"Yes","relevance":0.9}', [row])).toBeNull()
    expect(parseKalshiSearch({ current_page: [] })).toEqual([])
  })
})
