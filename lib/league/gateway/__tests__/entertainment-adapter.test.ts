import { describe, expect, it, vi } from 'vitest'
import { gatePublicGenerateInstrument } from '../../access-policy'
import { headerHeadline, showInstrumentDisplay } from '../../card-header-copy'
import { decideKobisGrade, parseKobisWeeklyList } from '../../entertainment/kobis'
import { ENTERTAINMENT_SLATE } from '../../entertainment/slate'
import { consensusMoneySearchHints } from '../../extra/consensus'
import { buildCrowSystemPrompt } from '../../extra/crow'
import { buildHistoryUserPrompt, buildHistoryInput } from '../../extra/history'
import { LEAGUE_UI } from '../../i18n/dictionary'
import { gradePlanFor } from '../grade-plan'
import { runLeagueGateway, type GatewayDeps } from '../shell'
import { createEntertainmentAdapter } from '../adapters/entertainment'
import { encodeEntertainmentInstrument } from '../adapters/entertainment-catalog'
import { buildEntertainmentRankedRoundInput } from '../adapters/entertainment-compose'
import type { EntertainmentPacketIo } from '../adapters/entertainment-packet'
import { resolveEntertainmentTarget } from '../adapters/entertainment-target'
import type { GatewayViewer } from '../types'

const NOW = new Date('2026-09-28T06:00:00.000Z')
const US: GatewayViewer = {
  userId: 'user-1',
  isAdmin: false,
  jurisdiction: { declaredCountry: 'US', ipCountry: 'US' },
}

function io(): EntertainmentPacketIo {
  return {
    listUpcoming: async () => [...ENTERTAINMENT_SLATE],
    readBaseline: async () => ({ marketPct: null, trackingNote: null }),
    getResearchPacket: async () => ({
      available: false,
      cached: false,
      cacheKey: 'x',
      directorModel: null,
      queries: [],
      findings: [],
      promptBlock: '',
      costUsd: 0,
      tier: 'high',
      synthesis: null,
    }),
  }
}

describe('entertainment subjective → objective', () => {
  const adapter = createEntertainmentAdapter(io(), () => NOW)

  it('turns 대박 into opening-weekend and admissions picks', async () => {
    const hit = await adapter.resolveEntity('치이카와 대박날까', 'ko', US)
    expect(hit.ok).toBe(false)
    if (!hit.ok && 'need' in hit) {
      expect(hit.need.options?.map((o) => o.label)).toEqual([
        '치이카와 · 개봉 첫 주말 박스오피스 1위',
        '치이카와 · 누적 300만 관객 돌파',
      ])
      expect(hit.need.options?.[0]?.id.startsWith('SHOW:boxoffice:KR:opening_1:')).toBe(true)
    }
  })

  it('turns a comeback question into chart #1 picks', () => {
    const hit = resolveEntertainmentTarget('뉴진스 컴백 대박날까', ENTERTAINMENT_SLATE, NOW)
    expect(hit.kind).toBe('picks')
    if (hit.kind === 'picks') {
      expect(hit.options.map((o) => o.label)).toEqual([
        'NewJeans · 멜론 주간 1위',
        'NewJeans · 빌보드 Hot 100 주간 1위',
      ])
    }
  })

  it('lists TGA nominees for 올해의 게임 and refuses Oscars outside the window', () => {
    const tga = resolveEntertainmentTarget('올해의 게임 누가', ENTERTAINMENT_SLATE, NOW)
    expect(tga.kind).toBe('picks')
    if (tga.kind === 'picks') expect(tga.options.length).toBe(3)
    expect(resolveEntertainmentTarget('오스카 작품상 누가', ENTERTAINMENT_SLATE, NOW).kind).toBe('unsupported')
  })

  it('refuses taste, private life, untrackable streams, and past titles', async () => {
    expect((await adapter.resolveEntity('이 영화 재밌을까', 'ko')).ok).toBe(false)
    expect(await adapter.resolveEntity('이 영화 재밌을까', 'ko')).toMatchObject({
      ok: false,
      refuse: { code: 'subjective_show' },
    })
    expect(await adapter.resolveEntity('이혼할까', 'ko')).toMatchObject({
      ok: false,
      refuse: { code: 'celebrity_private' },
    })
    expect(await adapter.resolveEntity('오징어게임3 대박날까', 'ko')).toMatchObject({
      ok: false,
      refuse: { code: 'no_result_source' },
    })
    expect(await adapter.resolveEntity('파묘 흥행할까', 'ko')).toMatchObject({
      ok: false,
      refuse: { code: 'past_show' },
    })
    expect(await adapter.resolveEntity('대박날까', 'ko')).toMatchObject({
      ok: false,
      refuse: { code: 'vague_show' },
    })
  })

  it('composes a threshold round and a readable headline, and generate accepts SHOW:', () => {
    const instrument = encodeEntertainmentInstrument({
      kind: 'boxoffice',
      venue: 'KR',
      event: 'admissions_3000000',
      subject: '치이카와',
      resolvesAtMs: Date.parse('2026-10-21T15:00:00.000Z'),
    })
    const round = buildEntertainmentRankedRoundInput(instrument, '1m', NOW)
    expect(round).toMatchObject({
      category: 'entertainment_awards',
      proposition_kind: 'binary_threshold',
      proposition_text: '치이카와 누적 300만 관객 돌파',
      subject_label: '치이카와',
    })
    expect(round?.proposition_text).not.toContain('SHOW:')
    expect(showInstrumentDisplay(instrument, 'ko')).toBe('치이카와 · 누적 300만 관객 돌파')
    const headline = headerHeadline({
      roundDate: '2026년 9월 28일',
      instrument,
      anchorPrice: null,
      anchorSessionDate: null,
      propositionKind: 'binary_threshold',
      locale: 'ko',
      t: LEAGUE_UI.ko,
    })
    expect(headline).toContain('치이카와 · 누적 300만 관객 돌파')
    expect(headline).not.toContain('SHOW:')
    expect(gatePublicGenerateInstrument(instrument, { isAdmin: false, jurisdiction: { ipCountry: 'US' } }, '1m')).toMatchObject({
      ok: true,
      category: 'entertainment_awards',
    })
  })

  it('parks awards on the operator and KR box office on KOBIS', () => {
    const award = encodeEntertainmentInstrument({
      kind: 'award',
      venue: 'tga',
      event: 'game_of_the_year',
      subject: 'Ghost of Yotei',
      resolvesAtMs: Date.parse('2026-12-11T02:00:00.000Z'),
    })
    const kr = encodeEntertainmentInstrument({
      kind: 'boxoffice',
      venue: 'KR',
      event: 'opening_1',
      subject: '치이카와',
      resolvesAtMs: Date.parse('2026-10-04T15:00:00.000Z'),
    })
    expect(gradePlanFor(adapter, award)).toEqual({ source: 'operator_manual' })
    expect(gradePlanFor(adapter, kr).source).toBe('kobis')
  })
})

describe('KOBIS weekend grade', () => {
  const rows = parseKobisWeeklyList({
    boxOfficeResult: {
      weeklyBoxOfficeList: [
        { rank: '1', movieNm: '극장판 치이카와', audiAcc: '4200000', audiCnt: '900000' },
        { rank: '2', movieNm: '부활남', audiAcc: '800000', audiCnt: '200000' },
      ],
    },
  })

  it('grades opening #1 and an admissions threshold without inventing a miss', () => {
    const opening = decideKobisGrade(
      { kind: 'boxoffice', venue: 'KR', event: 'opening_1', subject: '치이카와', resolvesAtMs: 1 },
      rows,
      '2026-10-04',
    )
    expect(opening).toMatchObject({ direction: 'up', resolutionPrice: 1 })
    const admissions = decideKobisGrade(
      { kind: 'boxoffice', venue: 'KR', event: 'admissions_3000000', subject: '부활남', resolvesAtMs: 1 },
      rows,
      '2026-10-04',
    )
    expect(admissions).toMatchObject({ direction: 'down', resolutionPrice: 800000 })
    expect(
      decideKobisGrade(
        { kind: 'boxoffice', venue: 'US', event: 'opening_1', subject: 'Godzilla', resolvesAtMs: 1 },
        rows,
        '2026-10-04',
      ),
    ).toBeNull()
  })
})

describe('entertainment extras do not fall through to price charts', () => {
  it('consensus abstains without a book, history uses comps, crow names flop risk', () => {
    expect(consensusMoneySearchHints('entertainment_awards')).toMatch(/ABSTAIN/)
    expect(consensusMoneySearchHints('entertainment_awards')).not.toMatch(/Elliott|price chart/i)
    const history = buildHistoryUserPrompt(
      buildHistoryInput(
        {
          proposition_text: '치이카와 개봉 첫 주말 박스오피스 1위',
          instrument: 'SHOW:boxoffice:KR:opening_1:x:1',
          horizon: '1w',
          category: 'entertainment_awards',
          subject_label: '치이카와',
          proposition_kind: 'binary_subject_outcome',
        },
        { bars: [] },
      ),
    )
    expect(history).toContain('비교작')
    expect(history).not.toContain('Daily closes')
    expect(buildCrowSystemPrompt('entertainment_awards')).toMatch(/flop risk|awards upset/i)
  })
})

describe('entertainment gateway clarify', () => {
  it('returns objective picks instead of low_confidence', async () => {
    const charge = vi.fn(async () => ({ ok: true }))
    const deps: GatewayDeps = {
      adapterFor: (id) => (id === 'entertainment' ? createEntertainmentAdapter(io(), () => NOW) : null),
      normalizer: { normalize: async () => null },
      searchCandidates: async () => null,
      deductCredits: charge,
      now: () => NOW,
    }
    const result = await runLeagueGateway(
      { viewer: US, category_id: 'entertainment', raw_text: '치이카와 대박날까', locale: 'ko' },
      deps,
    )
    expect(result.status).toBe('clarify')
    if (result.status === 'clarify') {
      expect(result.questions[0]?.options?.length).toBe(2)
      expect(result.questions[0]?.options?.[0]?.id.startsWith('SHOW:')).toBe(true)
    }
    expect(charge).not.toHaveBeenCalled()
  })
})
