import { describe, expect, it } from 'vitest'
import { POLITICS_CALIBRATION_GUIDANCE, SPORTS_CALIBRATION_GUIDANCE, answerContractFor, buildRoundPrompts, systemPromptFor } from '../../answer-contract'
import { buildConsensusUserPrompt, buildConsensusInput, consensusRationaleNeedsRetry } from '../../extra/consensus'
import { buildSentimentUserPrompt, buildSentimentInput, sentimentRationaleNeedsRetry } from '../../extra/sentiment'
import { isKrRaceBlackoutActive } from '../../jurisdiction/election-blackout'
import { isCategoryAllowed, isPromptAllowed } from '../../jurisdiction/resolve'
import { gradePlanFor } from '../grade-plan'
import { refusalMessageForKey } from '../refusal-copy'
import { createPoliticsAdapter } from '../adapters/politics'
import { decodePoliticsInstrument, encodePoliticsInstrument } from '../adapters/politics-catalog'
import { formatElectionProposition } from '../adapters/politics-catalog'
import { buildPoliticsRankedRoundInput } from '../adapters/politics-compose'
import { assemblePoliticsInjection, politicsSearchQueries } from '../adapters/politics-packet'
import type { PoliticsPacketIo } from '../adapters/politics-packet'
import { fetchJsonRetry, parseKalshiElectionEvents, parsePolymarketEvents, usGeneralElectionIso } from '../../politics/markets'
import { redactPollFigures } from '../../politics/poll-redact'
import { buildElectionBlackoutAlertText, listKrBlackoutAlerts } from '../../politics/blackout-alert'
import type { ElectionCandidateLite } from '../../politics/markets'
import type { GatewayViewer } from '../types'

const NOW = new Date('2026-09-28T00:00:00.000Z')
const POLL = '2026-11-03T23:00:00.000Z'

const SLATE: ElectionCandidateLite[] = [
  {
    jurisdiction: 'US',
    office: 'senate',
    cycle: '2026',
    district: 'IL',
    candidate: 'Juliana Stratton',
    pollCloseIso: POLL,
    kalshiPct: 97.8,
    polymarketPct: 96.1,
  },
  {
    jurisdiction: 'US',
    office: 'senate',
    cycle: '2026',
    district: 'IL',
    candidate: 'Don Tracy',
    pollCloseIso: POLL,
    kalshiPct: 2.1,
    polymarketPct: null,
  },
  {
    jurisdiction: 'US',
    office: 'governor',
    cycle: '2026',
    district: 'GA',
    candidate: 'Stacey Abrams',
    pollCloseIso: POLL,
    kalshiPct: 41,
    polymarketPct: 44,
  },
  {
    jurisdiction: 'US',
    office: 'president',
    cycle: '2026',
    district: '_',
    candidate: 'Donald Trump',
    pollCloseIso: POLL,
    kalshiPct: 12,
    polymarketPct: 15,
  },
  {
    jurisdiction: 'KR',
    office: 'mayor',
    cycle: '2026',
    district: '_',
    candidate: 'Lee Jae-myung',
    pollCloseIso: '2026-06-03T09:00:00.000Z',
    kalshiPct: null,
    polymarketPct: 55,
  },
  {
    jurisdiction: 'US',
    office: 'house',
    cycle: '2026',
    district: 'NJ-11',
    candidate: 'Special Candidate',
    pollCloseIso: '2026-06-10T23:00:00.000Z',
    kalshiPct: 52,
    polymarketPct: 51,
  },
]

const io: PoliticsPacketIo = {
  listUpcoming: async () => SLATE,
  readBaseline: async () => ({ kalshiPct: 97.8, polymarketPct: 96.1 }),
  readPolls: async () => [{ source: 'VoteHub', summary: 'generic ballot supplement' }],
  getResearchPacket: async () => ({
    available: true,
    cached: false,
    cacheKey: 'pol',
    queries: ['news'],
    findings: [
      { query: 'scandal', summary: 'A documented withdrawal shook the race.' },
      { query: 'poll', summary: '여론조사 지지율 42% 로 앞선다. 사퇴 소식은 그대로다.' },
    ],
    costUsd: 0.01,
    tier: 'high',
  }),
}

const adapter = createPoliticsAdapter(io, () => NOW)

const krViewer: GatewayViewer = {
  userId: 'u',
  isAdmin: false,
  jurisdiction: { declaredCountry: 'KR', ipCountry: 'US' },
}
const usViewer: GatewayViewer = {
  userId: 'u',
  isAdmin: false,
  jurisdiction: { declaredCountry: 'US', ipCountry: 'US' },
}

describe('politics markets + blackout', () => {
  it('maps the 2026 US general to November 3', () => {
    expect(usGeneralElectionIso(2026)).toBe('2026-11-03T23:00:00.000Z')
  })

  it('parses Kalshi senate and governor prices onto the general-election day inside the window', () => {
    const rows = parseKalshiElectionEvents(
      {
        events: [
          {
            category: 'Elections',
            title: 'Illinois Senate winner?',
            event_ticker: 'SENATEIL-26',
            series_ticker: 'SENATEIL',
            markets: [
              {
                status: 'active',
                yes_sub_title: 'Juliana Stratton',
                close_time: '2027-11-03T15:00:00Z',
                yes_bid_dollars: '0.970',
                yes_ask_dollars: '0.980',
              },
            ],
          },
          {
            category: 'Elections',
            title: 'Georgia Governor winner?',
            event_ticker: 'GOVPARTYGA-26',
            series_ticker: 'GOVPARTYGA',
            markets: [
              {
                status: 'active',
                yes_sub_title: 'Keisha Lance Bottoms',
                close_time: '2027-11-03T15:00:00Z',
                yes_bid_dollars: '0.500',
                yes_ask_dollars: '0.510',
              },
            ],
          },
        ],
      },
      NOW,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      jurisdiction: 'US',
      office: 'senate',
      district: 'IL',
      candidate: 'Juliana Stratton',
      pollCloseIso: POLL,
      kalshiPct: 97.5,
    })
    expect(rows[1]).toMatchObject({
      jurisdiction: 'US',
      office: 'governor',
      district: 'GA',
      candidate: 'Keisha Lance Bottoms',
      pollCloseIso: POLL,
      kalshiPct: 50.5,
    })
  })

  it('parses Polymarket outcomePrices and retries through a Cloudflare 1026 body', async () => {
    const rows = parsePolymarketEvents(
      [
        {
          title: 'Georgia Governor Election 2026',
          endDate: POLL,
          markets: [
            {
              groupItemTitle: 'Stacey Abrams',
              outcomes: '["Yes","No"]',
              outcomePrices: '["0.44","0.56"]',
            },
          ],
        },
      ],
      NOW,
    )
    expect(rows[0]?.polymarketPct).toBe(44)
    expect(rows[0]?.office).toBe('governor')

    let calls = 0
    const body = await fetchJsonRetry('https://gamma-api.polymarket.com/events', async () => {
      calls += 1
      if (calls === 1) {
        return new Response('error code: 1026', { status: 403 })
      }
      return new Response(JSON.stringify([{ title: 'ok' }]), { status: 200 })
    })
    expect(calls).toBe(2)
    expect(body).toEqual([{ title: 'ok' }])
  })

  it('keeps the politics category open for KR users during a race blackout and alerts on D-6', () => {
    const during = Date.parse('2026-05-30T00:00:00.000Z')
    expect(isKrRaceBlackoutActive(during)).toBe(true)
    expect(isCategoryAllowed('politics_election', { declaredCountry: 'KR', ipCountry: 'KR' }, during)).toBe(true)
    expect(isCategoryAllowed('politics_election', { ipCountry: 'US' }, during)).toBe(true)
    const alerts = listKrBlackoutAlerts(during)
    expect(alerts[0]?.text).toBe(buildElectionBlackoutAlertText('제9회 전국동시지방선거'))
    expect(alerts[0]?.text).toContain('한국 노출 중단')
    expect(listKrBlackoutAlerts(NOW.getTime())).toEqual([])
  })

  it('turns politics prompts off for CN and ME', () => {
    expect(isPromptAllowed('politics_election', { declaredCountry: 'CN', ipCountry: 'CN' })).toBe(false)
    expect(isPromptAllowed('politics_election', { declaredCountry: 'AE', ipCountry: 'AE' })).toBe(false)
    expect(isPromptAllowed('politics_election', { declaredCountry: 'KR', ipCountry: 'US' })).toBe(true)
  })
})

describe('politics CategoryAdapter', () => {
  it('resolves a named candidate and an office, and refuses vague input', async () => {
    const trump = await adapter.resolveEntity('트럼프 당선될까', 'ko', usViewer)
    expect(trump.ok).toBe(true)
    if (trump.ok) {
      const parts = decodePoliticsInstrument(trump.entity_id)
      expect(parts?.candidate).toBe('Donald Trump')
      expect(formatElectionProposition(parts!)).toBe('2026 미국 대통령 Donald Trump 당선')
    }

    const gov = await adapter.resolveEntity('조지아 주지사', 'ko', usViewer)
    expect(gov.ok).toBe(true)

    const vague = await adapter.resolveEntity('누가 당선될까', 'ko', usViewer)
    expect(vague.ok).toBe(false)
    if (!vague.ok && 'refuse' in vague) {
      expect(vague.refuse.code).toBe('vague_election')
      expect(refusalMessageForKey(vague.refuse.message_i18n_key, 'ko')).toContain('조지아 주지사')
    }
  })

  it('offers picks when an office has more than one candidate', async () => {
    const hit = await adapter.resolveEntity('일리노이 상원', 'ko', usViewer)
    expect(hit.ok).toBe(false)
    if (!hit.ok && 'need' in hit) {
      expect(hit.need.options?.length).toBe(2)
      expect(hit.need.options?.[0]?.label).toContain('Juliana Stratton')
    }

    const gaHit = await adapter.resolveEntity('조지아 상원', 'ko', usViewer)
    // In test SLATE, GA governor is present but GA senate is not in mock slate, so returns unsupported
    expect(gaHit.ok).toBe(false)

    // And Georgia Governor returns picks for Stacey Abrams
    const gaGov = await adapter.resolveEntity('조지아 주지사', 'ko', usViewer)
    expect(gaGov.ok).toBe(true)
  })

  it('blocks only KR races for KR viewers during that race D-6, and leaves US races open', async () => {
    const blackoutAdapter = createPoliticsAdapter(io, () => new Date('2026-06-01T00:00:00.000Z'))
    const blocked = await blackoutAdapter.resolveEntity('이재명 당선', 'ko', krViewer)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok && 'refuse' in blocked) expect(blocked.refuse.code).toBe('politics_window')

    const usDuring = await blackoutAdapter.resolveEntity('Special Candidate 당선', 'ko', krViewer)
    expect(usDuring.ok).toBe(true)

    const openForUs = await blackoutAdapter.resolveEntity('이재명 당선', 'ko', usViewer)
    expect(openForUs.ok).toBe(true)
  })

  it('composes a 당선 proposition, caps horizon at 3m, and parks grading on operator_manual', () => {
    const encoded = encodePoliticsInstrument({
      jurisdiction: 'US',
      office: 'senate',
      cycle: '2026',
      district: 'IL',
      candidate: 'Juliana Stratton',
      pollCloseMs: Date.parse(POLL),
    })
    const round = buildPoliticsRankedRoundInput(encoded, undefined, NOW)!
    expect(round.proposition_text).toContain('Juliana Stratton 당선')
    expect(round.proposition_text).not.toContain('지지율')
    expect(round.horizon).toBe('1m')
    expect(round.resolves_at).toBe(POLL)
    expect(gradePlanFor(adapter, encoded)).toEqual({ source: 'operator_manual' })
  })

  it('packet uses market baseline, news queries, and strips KR poll percentages', async () => {
    const encoded = encodePoliticsInstrument({
      jurisdiction: 'KR',
      office: 'mayor',
      cycle: '2026',
      district: '_',
      candidate: 'Lee Jae-myung',
      pollCloseMs: Date.parse('2026-10-02T09:00:00.000Z'),
    })
    const parts = decodePoliticsInstrument(encoded)!
    const queries = politicsSearchQueries(parts, true)
    expect(queries.some((q) => /scandal|스캔들|debate|turnout|incumbency/i.test(q.q))).toBe(true)
    expect(queries.some((q) => /Do not quote poll percentages/.test(q.q))).toBe(true)

    const packet = await adapter.buildPacket(adapter.slotsForRound({
      proposition_text: '2026 한국 시장 Lee Jae-myung 당선',
      category: 'politics_election',
      instrument: encoded,
      horizon: '3m',
      resolution_rule: 'official',
      resolves_at: '2026-10-02T09:00:00.000Z',
    }), {
      round: {
        proposition_text: '2026 한국 시장 Lee Jae-myung 당선',
        category: 'politics_election',
        instrument: encoded,
        horizon: '3m',
        resolution_rule: 'official',
        resolves_at: '2026-10-02T09:00:00.000Z',
      },
      costCapUsd: 1,
    })
    expect(packet.injection).toContain('해외 예측시장 데이터')
    expect(packet.injection).toContain('KOREA BLACKOUT')
    expect(packet.injection).not.toContain('42%')
    expect(packet.injection).toContain('사퇴 소식은 그대로다')
    expect(redactPollFigures('여론조사 지지율 42% 로 앞선다.')).not.toContain('42%')
    expect(assemblePoliticsInjection({
      round: {
        proposition_text: 'x',
        category: 'politics_election',
        instrument: encoded,
        horizon: '1m',
        resolution_rule: 'r',
        resolves_at: POLL,
      },
      parts: decodePoliticsInstrument(encodePoliticsInstrument({
        jurisdiction: 'US',
        office: 'senate',
        cycle: '2026',
        district: 'IL',
        candidate: 'Juliana Stratton',
        pollCloseMs: Date.parse(POLL),
      }))!,
      baseline: { kalshiPct: 97.8, polymarketPct: null },
      polls: [{ source: 'VoteHub', summary: 'senate supplement' }],
      research: { available: true, cached: false, cacheKey: 'k', queries: [], findings: [], costUsd: 0, tier: 'high' },
      nowMs: NOW.getTime(),
    })).toContain('VoteHub')
  })
})

describe('politics extra seats + calibration', () => {
  it('injects politics calibration and not the sports one', () => {
    const contract = answerContractFor('binary_subject_outcome')
    const closed = systemPromptFor({ league_tier: 'premier' }, contract, 'politics_election')
    expect(closed).toContain(POLITICS_CALIBRATION_GUIDANCE)
    expect(closed).not.toContain(SPORTS_CALIBRATION_GUIDANCE)
    const round = {
      proposition_text: '2026 미국 대통령 Donald Trump 당선',
      instrument: 'ELECTION:US:president:2026:_:Donald%20Trump:1',
      category: 'politics_election',
      horizon: '1m',
      resolution_rule: 'official',
      resolves_at: POLL,
    }
    expect(buildRoundPrompts(contract, round, 'PACKET').price).toContain(POLITICS_CALIBRATION_GUIDANCE)
  })

  it('wires sentiment to news and consensus to prediction markets, and strips KR poll cites', () => {
    const sentiment = buildSentimentUserPrompt(buildSentimentInput({
      proposition_text: '2026 미국 상원 Juliana Stratton 당선',
      category: 'politics_election',
      instrument: 'ELECTION:US:senate:2026:IL:Juliana%20Stratton:1',
      proposition_kind: 'binary_subject_outcome',
      subject_label: 'Juliana Stratton',
    }))
    expect(sentiment).toMatch(/scandal|debate|momentum/i)
    expect(sentiment).not.toContain('web-visible crowd sentiment only')

    const krInstrument = encodePoliticsInstrument({
      jurisdiction: 'KR',
      office: 'mayor',
      cycle: '2026',
      district: '_',
      candidate: 'Lee Jae-myung',
      pollCloseMs: Date.parse('2026-06-03T09:00:00.000Z'),
    })
    const krSentiment = buildSentimentUserPrompt(buildSentimentInput({
      proposition_text: 'Lee Jae-myung 당선',
      category: 'politics_election',
      instrument: krInstrument,
      proposition_kind: 'binary_subject_outcome',
    }))
    expect(krSentiment).toContain('지지율')
    expect(sentimentRationaleNeedsRetry('여론조사 지지율 42% 로 앞선다. 스캔들이 화제다.', 'politics_election', krInstrument)).toBe(true)

    const money = buildConsensusUserPrompt(buildConsensusInput({
      proposition_text: 'Juliana Stratton 당선',
      category: 'politics_election',
      instrument: 'ELECTION:US:senate:2026:IL:x:1',
      proposition_kind: 'binary_subject_outcome',
    }))
    expect(money).toContain('해외 예측시장')
    expect(money).toContain('Kalshi')
    expect(consensusRationaleNeedsRetry('예측시장 배당은 상승이다', 'politics_election')).toBe(true)
    expect(consensusRationaleNeedsRetry('예측시장 내재 확률은 Kalshi 쪽에 가깝다', 'politics_election')).toBe(false)
  })
})
