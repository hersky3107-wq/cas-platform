import { describe, expect, it } from 'vitest'
import { gatePublicGenerateInstrument } from '../../access-policy'
import { assertApprovedCopy } from '../../compliance'
import { buildDivinationInput } from '../../extra/divination'
import { consensusMoneySearchHints } from '../../extra/consensus'
import { buildCrowSystemPrompt } from '../../extra/crow'
import { buildHistorySystemPrompt } from '../../extra/history'
import { buildSentimentUserPrompt, buildSentimentInput } from '../../extra/sentiment'
import { isPromptAllowedForGroup } from '../../jurisdiction/prompt-matrix'
import { gradePlanFor } from '../grade-plan'
import { refusalMessageForKey } from '../refusal-copy'
import { createRealEstateAdapter } from '../adapters/real-estate'
import { buildRealEstateRankedRoundInput } from '../adapters/real-estate-compose'
import { propertyHeadlineLabel } from '../adapters/real-estate-catalog'
import type { RealEstatePacketIo } from '../adapters/real-estate-packet'

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

  it('parses a percent threshold and the US national index', async () => {
    const gangnam = await adapter.resolveEntity('강남 전월비 1% 넘길까', 'ko')
    expect(gangnam).toMatchObject({
      ok: true,
      entity_id: 'PROPERTY:KR:11680:apt_sale_mom_gt100:2026-09',
    })
    const us = await adapter.resolveEntity('미국 부동산 오를까', 'ko')
    expect(us).toMatchObject({ ok: true, entity_id: 'PROPERTY:US:CSUSHPINSA:hpi_mom:2026-07' })
    const sydney = await adapter.resolveEntity('시드니 집값 오를까', 'ko')
    expect(sydney).toMatchObject({ ok: true, entity_id: 'PROPERTY:AU:SYD:hpi_qoq:2026-09' })
    const tokyo = await adapter.resolveEntity('도쿄 집값 오를까', 'ko')
    expect(tokyo).toMatchObject({ ok: true, entity_id: 'PROPERTY:JP:13:hpi_mom:2026-07' })
    const london = await adapter.resolveEntity('런던 집값 오를까', 'ko')
    expect(london).toMatchObject({ ok: true, entity_id: 'PROPERTY:UK:E12000007:hpi_mom:2026-08' })
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

  it('extras: consensus abstains, crow stays regional, divination uses the publication date', () => {
    expect(consensusMoneySearchHints('real_estate')).toMatch(/ABSTAIN/)
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
})
