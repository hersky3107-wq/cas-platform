import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { gatePublicGenerateInstrument } from '../../access-policy'
import { assertApprovedCopy } from '../../compliance'
import { buildDivinationInput } from '../../extra/divination'
import { consensusMoneySearchHints } from '../../extra/consensus'
import { buildCrowSystemPrompt } from '../../extra/crow'
import { buildHistorySystemPrompt } from '../../extra/history'
import { buildSentimentUserPrompt, buildSentimentInput } from '../../extra/sentiment'
import { getLeagueUiPack } from '../../i18n/dictionary'
import { isPromptAllowedForGroup } from '../../jurisdiction/prompt-matrix'
import { formatPropertyGradeLine, formatPropertyHorizonLabel } from '../../real-estate-display'
import { sideLabelsFor } from '../../side-labels'
import { gradePlanFor } from '../grade-plan'
import { refusalMessageForKey } from '../refusal-copy'
import { isSlateBackedCategory, runLeagueGateway } from '../shell'
import { createRealEstateAdapter } from '../adapters/real-estate'
import { buildRealEstateRankedRoundInput } from '../adapters/real-estate-compose'
import { decodePropertyInstrument, propertyHeadlineLabel } from '../adapters/real-estate-catalog'
import { propertySearchQueries } from '../adapters/real-estate-packet'
import type { RealEstatePacketIo } from '../adapters/real-estate-packet'
import type { GatewayViewer } from '../types'

const NOW = new Date('2026-09-28T09:00:00.000Z')
const io: RealEstatePacketIo = {
  getResearchPacket: async () => {
    throw new Error('packet io must not be called')
  },
}
const adapter = createRealEstateAdapter(io, () => NOW)

describe('real estate housing index', () => {
  it('anchors 강남 to the next unpublished 시군구 month', async () => {
    const hit = await adapter.resolveEntity('강남 오를까', 'ko')
    expect(hit).toMatchObject({
      ok: true,
      entity_id: 'PROPERTY:KR:11680:apt_sale_mom:2026-09',
      label: '강남구',
    })
    const round = buildRealEstateRankedRoundInput('PROPERTY:KR:11680:apt_sale_mom:2026-09', '1m', NOW)
    expect(round?.proposition_text).toBe(
      '[부동산원 2026-10-15 공표분, 기준월 2026-09] 강남구 아파트 매매가격지수 전월대비 상승?',
    )
    expect(round?.proposition_text).not.toContain('PROPERTY:')
    expect(round?.resolves_at.slice(0, 10)).toBe('2026-10-15')
    expect(round?.category).toBe('real_estate')
    expect(round?.resolution_rule).toMatch(/first official publication/)
    expect(round?.resolution_rule).toMatch(/통계정정/)
    expect(propertyHeadlineLabel(round!.instrument, 'ko')).toBe('강남구 · 전월 2026-09')
    expect(gradePlanFor(adapter, round!.instrument)).toEqual({ source: 'operator_manual' })
  })

  it('parses a percent threshold and named cities, but country queries become picks', async () => {
    const gangnam = await adapter.resolveEntity('강남 전월비 1% 넘길까', 'ko')
    expect(gangnam).toMatchObject({
      ok: true,
      entity_id: 'PROPERTY:KR:11680:apt_sale_mom_gt100:2026-09',
    })
    const us = await adapter.resolveEntity('미국 부동산 오를까', 'ko')
    expect(us.ok).toBe(false)
    if (!us.ok && 'need' in us) {
      const ids = us.need.options?.map((o) => o.id) ?? []
      expect(ids.some((id) => id.includes(':NYXRNSA:'))).toBe(true)
      expect(ids.some((id) => id.includes(':LXXRNSA:'))).toBe(true)
      expect(ids.some((id) => id.includes(':CSUSHPINSA:'))).toBe(true)
      expect(ids.at(-1)).toContain(':CSUSHPINSA:')
      expect(us.need.options?.at(-1)?.label).toBe('미국 전국')
    }
    const usNation = await adapter.resolveEntity('미국 전국 오를까', 'ko')
    expect(usNation).toMatchObject({ ok: true, entity_id: 'PROPERTY:US:CSUSHPINSA:hpi_mom:2026-07' })
    const seoul = await adapter.resolveEntity('서울 아파트 가격지수 오를까', 'ko')
    expect(seoul.ok).toBe(false)
    if (!seoul.ok && 'need' in seoul) {
      expect(seoul.need.options?.some((o) => o.id.includes(':11680:'))).toBe(true)
      expect(seoul.need.options?.at(-1)?.label).toBe('서울 전체')
    }
    const jp = await adapter.resolveEntity('일본 집값 오를까', 'ko')
    expect(jp.ok).toBe(false)
    if (!jp.ok && 'need' in jp) {
      const labels = jp.need.options?.map((o) => o.label) ?? []
      expect(labels).toEqual(expect.arrayContaining(['도쿄도', '오사카부', '아이치현', '일본 전국']))
    }
    const sydney = await adapter.resolveEntity('시드니 집값 오를까', 'ko')
    expect(sydney).toMatchObject({ ok: true, entity_id: 'PROPERTY:AU:SYD:hpi_qoq:2026-09' })
    const tokyo = await adapter.resolveEntity('도쿄 집값 오를까', 'ko')
    expect(tokyo).toMatchObject({ ok: true, entity_id: 'PROPERTY:JP:13:hpi_mom:2026-07' })
    const london = await adapter.resolveEntity('런던 집값 오를까', 'ko')
    expect(london).toMatchObject({ ok: true, entity_id: 'PROPERTY:UK:E12000007:hpi_mom:2026-08' })
    const ny = await adapter.resolveEntity('뉴욕 오를까', 'ko')
    expect(ny).toMatchObject({ ok: true, label: '뉴욕' })
  })

  it('refuses a dong, a complex, a trading area, and brokerage', async () => {
    for (const raw of ['대치동', '래미안', '은마', '강남역 상권']) {
      const hit = await adapter.resolveEntity(raw, 'ko')
      expect(hit.ok).toBe(false)
      if (!hit.ok && 'refuse' in hit) expect(hit.refuse.code).toBe('specific_property')
    }
    const buy = await adapter.resolveEntity('지금 살까', 'ko')
    expect(buy.ok).toBe(false)
    if (!buy.ok && 'refuse' in buy) expect(buy.refuse.code).toBe('brokerage_advice')
    const copy = refusalMessageForKey('league.gateway.refusal.specific_property', 'ko')
    expect(copy).toContain('강남구')
    assertApprovedCopy(copy)
  })

  it('keeps 금천구 and does not treat 강동구 as a dong', async () => {
    expect(await adapter.resolveEntity('금천구 오를까', 'ko')).toMatchObject({
      ok: true,
      entity_id: 'PROPERTY:KR:11545:apt_sale_mom:2026-09',
    })
    expect(await adapter.resolveEntity('강동구 오를까', 'ko')).toMatchObject({
      ok: true,
      label: '강동구',
    })
  })

  it('generate accepts PROPERTY and the Korean prompt is on', () => {
    const instrument = 'PROPERTY:KR:11680:apt_sale_mom:2026-09'
    expect(gatePublicGenerateInstrument(instrument, { isAdmin: false, jurisdiction: { ipCountry: 'KR' } }, '1m')).toMatchObject({
      ok: true,
      category: 'real_estate',
    })
    expect(isPromptAllowedForGroup('KR', 'real_estate')).toBe(true)
    expect(isPromptAllowedForGroup('CN', 'real_estate')).toBe(false)
    expect(gatePublicGenerateInstrument('VNQ', { isAdmin: false, jurisdiction: { ipCountry: 'US' } })).toMatchObject({
      ok: true,
      category: 'etf_index',
      instrument: 'VNQ',
    })
  })

  it('extras: consensus uses 거래량/실거래가, crow stays regional, divination uses the publication date', () => {
    expect(consensusMoneySearchHints('real_estate')).toMatch(/실거래/)
    expect(consensusMoneySearchHints('real_estate')).toMatch(/existing-home/)
    expect(consensusMoneySearchHints('real_estate')).toMatch(/ABSTAIN only if/)
    expect(consensusMoneySearchHints('real_estate')).not.toMatch(/For HOUSING INDEXES, ABSTAIN/)
    expect(buildCrowSystemPrompt('real_estate')).toMatch(/overheating/)
    expect(buildCrowSystemPrompt('real_estate')).toMatch(/complex/)
    expect(buildHistorySystemPrompt('real_estate')).toMatch(/상승기/)
    const sentiment = buildSentimentUserPrompt(
      buildSentimentInput({
        proposition_text: '강남구',
        instrument: 'PROPERTY:KR:11680:apt_sale_mom:2026-09',
        category: 'real_estate',
        horizon: '1m',
        subject_label: '강남구',
      }),
    )
    expect(sentiment).toMatch(/permits/)
    expect(sentiment).toMatch(/Do not cite a named apartment complex/)
    const divination = buildDivinationInput({
      id: 'r1',
      proposition_text: '강남',
      category: 'real_estate',
      instrument: 'PROPERTY:KR:11680:apt_sale_mom:2026-09',
      opened_at: '2026-09-28T00:00:00.000Z',
      proposition_kind: 'binary_subject_outcome',
    })
    expect(divination.firstViewedAt.slice(0, 10)).toBe('2026-10-15')
    expect(divination.propositionType).toBe('binary')
  })

  it('is slate-backed freeform: typed region generates without catalog chips', async () => {
    expect(isSlateBackedCategory('real_estate')).toBe(true)
    expect(isSlateBackedCategory('sports')).toBe(true)
    expect(isSlateBackedCategory('gold_metals')).toBe(false)
    const KR: GatewayViewer = {
      userId: 'user-kr',
      isAdmin: false,
      jurisdiction: { declaredCountry: 'KR', ipCountry: 'KR' },
    }
    const charge = vi.fn(async () => ({ ok: true }))
    const deps = {
      adapterFor: (id: string) => (id === 'real_estate' ? adapter : null),
      normalizer: { normalize: async () => null },
      searchCandidates: async () => null,
      deductCredits: charge,
      now: () => NOW,
    }
    const ready = await runLeagueGateway(
      { viewer: KR, category_id: 'real_estate', raw_text: '강남 오를까', locale: 'ko' },
      deps,
    )
    expect(ready.status).toBe('ready')
    if (ready.status === 'ready') {
      expect(ready.round.instrument).toBe('PROPERTY:KR:11680:apt_sale_mom:2026-09')
      expect(ready.round.proposition_text).not.toContain('PROPERTY:')
    }
    const seoul = await runLeagueGateway(
      { viewer: KR, category_id: 'real_estate', raw_text: '서울 아파트 가격지수 오를까', locale: 'ko' },
      deps,
    )
    expect(seoul.status).toBe('clarify')
    if (seoul.status === 'clarify') {
      expect(seoul.questions[0]?.options?.some((o) => o.id.includes(':11680:'))).toBe(true)
    }
    expect(charge).toHaveBeenCalledOnce()
  })

  it('side labels are 상승/하락 and the card names the publication deadline', () => {
    const t = getLeagueUiPack('ko')
    const labels = sideLabelsFor(
      {
        proposition_kind: 'binary_subject_outcome',
        category: 'real_estate',
        subject_label: '강남구',
        instrument: 'PROPERTY:KR:11680:apt_sale_mom:2026-09',
      },
      t,
      'ko',
    )
    expect(labels.answer('yes')).toBe('강남구 상승')
    expect(labels.answer('no')).toBe('강남구 하락')
    expect(labels.badge('yes')).toBe('강남구 상승')
    const us = sideLabelsFor(
      {
        proposition_kind: 'binary_subject_outcome',
        category: 'real_estate',
        subject_label: '미국',
        instrument: 'PROPERTY:US:CSUSHPINSA:hpi_mom:2026-07',
      },
      t,
      'ko',
    )
    expect(us.answer('yes')).toBe('미국 상승')
    expect(us.answer('no')).toBe('미국 하락')
    const tech = sideLabelsFor(
      { proposition_kind: 'binary_subject_outcome', category: 'tech', subject_label: 'Apple' },
      t,
      'ko',
    )
    expect(tech.answer('yes')).toBe('Apple 실현')
    const inst = 'PROPERTY:KR:11680:apt_sale_mom:2026-09'
    expect(formatPropertyHorizonLabel(inst, t)).toBe('월간 공표')
    expect(formatPropertyHorizonLabel('PROPERTY:AU:SYD:hpi_qoq:2026-09', t)).toBe('분기 공표')
    const grade = formatPropertyGradeLine({
      instrument: inst,
      resolvesAt: '2026-10-15T00:00:00.000Z',
      locale: 'ko',
      t,
      now: NOW,
    })
    expect(grade).toBe('채점: 2026년 10월 15일 공표분 기준 (17일 남음)')
    expect(t.disclaimer.realEstateScope).toContain('단지')
    const parts = decodePropertyInstrument(inst)!
    expect(propertySearchQueries(parts).some((q) => /실거래|existing home/i.test(q.q))).toBe(true)
    expect(propertySearchQueries(parts).some((q) => /correction risk|supply overhang/i.test(q.q))).toBe(true)
  })

  it('hub stays coming_soon: no injected region chips, no horizon selector', () => {
    const instrumentsRoute = readFileSync(join(__dirname, '../../../../app/api/league/instruments/route.ts'), 'utf8')
    const hub = readFileSync(join(__dirname, '../../../../components/league/PublicLeagueHub.tsx'), 'utf8')
    expect(instrumentsRoute).not.toContain('headlinePropertyInstruments')
    expect(instrumentsRoute).not.toContain("c.id === 'real_estate'")
    expect(hub).toContain("cat.id === 'real_estate'")
    expect(hub).toContain("active.id !== 'real_estate'")
    expect(hub).toContain('usesHorizonChipRow(active.id)')
  })
})
