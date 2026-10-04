import { describe, expect, it } from 'vitest'
import { createTechAdapter } from '../../gateway/adapters/tech'
import { refusalMessageForKey } from '../../gateway/refusal-copy'
import { assertApprovedCopy } from '../../compliance'
import type { NormalizeSlots } from '../../gateway/types'
import { decodeAirankInstrument } from '../instrument'
import { AIRANK_CAMP_OTHER_BRANDS, campOfBrand } from '../brands'
import { gradeAirankSnapshot } from '../grade'
import { parseAirankPrompt } from '../resolve'
import { gatePublicGenerateInstrument } from '../../access-policy'
import { stripSelfVendorMarkers } from '../self-vendor'

const NOW = new Date('2026-10-04T03:00:00.000Z')
const adapter = createTechAdapter(
  { getResearchPacket: async () => { throw new Error('io must not be called') } },
  () => NOW,
)

function slots(over: Partial<NormalizeSlots> = {}): NormalizeSlots {
  const { slots: extra, ...rest } = over
  return {
    category_id: 'tech',
    entity_id: '',
    entity_kind: 'company',
    entity_label: '',
    horizon: '1d',
    resolve_by: null,
    proposition_kind: 'binary_subject_outcome',
    confidence: 1,
    ...rest,
    slots: { locale: 'ko', ...extra },
  }
}

async function resolveCompose(text: string, locale: 'ko' | 'en' = 'ko') {
  const r = await adapter.resolveEntity(text, locale)
  expect(r.ok, text).toBe(true)
  if (!r.ok) throw new Error(text)
  const composed = adapter.composeProposition(
    slots({ entity_id: r.entity_id, entity_label: r.label, slots: { locale } }),
    NOW,
  )
  return { r, composed, parts: decodeAirankInstrument(r.entity_id) }
}

describe('AIRANK prompt routing from the tech free-prompt', () => {
  it('parses the required Korean and English ranking prompts', async () => {
    const google = await resolveCompose('구글이 이번 달 말 AI 1위 할까?')
    expect(google.parts).toMatchObject({
      arena: 'text',
      category: 'overall',
      kind: 'brand_rank1',
      subject: 'Google',
      deadlineYmd: '2026-10-31',
    })
    expect(google.composed.category).toBe('ai_models')
    expect(google.composed.horizon).toBe('1m')
    expect(google.composed.proposition_text).toBe(
      '구글이 2026-10-31 이후 처음 발표되는 LMArena 종합 순위에서 1위일까?',
    )

    const above = await resolveCompose('클로드가 코딩에서 GPT보다 위일까?')
    expect(above.parts).toMatchObject({
      arena: 'text',
      category: 'coding',
      kind: 'brand_above',
      subject: 'Anthropic',
      param: 'OpenAI',
      deadlineYmd: '2026-10-31',
    })
    expect(above.composed.proposition_text).toContain('코딩 순위')
    expect(above.composed.proposition_text).toContain('보다 위일까')

    const camp = await resolveCompose('중국 AI가 이번 달 3위 안에 들까?')
    expect(camp.parts).toMatchObject({
      kind: 'camp_topn',
      subject: 'china',
      param: '3',
      deadlineYmd: '2026-10-31',
    })
    expect(camp.composed.proposition_text).toBe(
      '중국 AI가 2026-10-31 이후 처음 발표되는 LMArena 종합 순위에서 3위 안에 들까?',
    )

    const model = await resolveCompose('GPT-6가 다음 달 말까지 1위 할까?')
    expect(model.parts).toMatchObject({
      kind: 'model_rank1',
      subject: 'GPT-6',
      deadlineYmd: '2026-11-30',
    })
    expect(model.composed.horizon).toBe('3m')
    expect(model.composed.proposition_text).toContain('GPT-6')
    expect(model.composed.proposition_text).toContain('이후 처음 발표되는')

    const flux = await resolveCompose('이미지 생성 1위 다음 달에도 플럭스일까?')
    expect(flux.parts).toMatchObject({
      arena: 'text_to_image',
      category: 'overall',
      kind: 'brand_rank1',
      subject: 'Black Forest Labs',
      deadlineYmd: '2026-11-30',
    })
    expect(flux.composed.proposition_text).toContain('이미지 생성')

    const en = await resolveCompose('Will Gemini be #1 in math by Nov 30?', 'en')
    expect(en.parts).toMatchObject({
      arena: 'text',
      category: 'math',
      kind: 'brand_rank1',
      subject: 'Google',
      deadlineYmd: '2026-11-30',
    })
    expect(en.composed.horizon).toBe('3m')
    expect(en.composed.proposition_text).toBe(
      'Will Google be #1 on the first LMArena math ranking published on or after 2026-11-30?',
    )
  })

  it('refuses unsupported fields, sub-week deadlines, and far deadlines', async () => {
    const cases: Array<[string, string]> = [
      ['한국어 1위는?', 'unsupported_field'],
      ['내일 1위는?', 'airank_min_horizon'],
      ['내년 말 1위는?', 'deadline_too_far'],
    ]
    for (const [text, code] of cases) {
      const r = await adapter.resolveEntity(text, 'ko')
      expect(r.ok, text).toBe(false)
      if (r.ok || !('refuse' in r)) throw new Error(text)
      expect(r.refuse.code, text).toBe(code)
      const ko = refusalMessageForKey(r.refuse.message_i18n_key, 'ko')
      expect(ko).toMatch(/[\uAC00-\uD7A3]/)
      assertApprovedCopy(ko)
    }
    expect(refusalMessageForKey('league.gateway.refusal.unsupported_field', 'ko')).toContain('종합')
    expect(refusalMessageForKey('league.gateway.refusal.airank_min_horizon', 'ko')).toBe(
      'AI 순위는 1주 이상만 가능합니다.',
    )
  })

  it('keeps a non-ranking tech prompt on the tech path', async () => {
    const r = await adapter.resolveEntity('애플이 이번 달 폴더블을 발표할까?', 'ko')
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected tech')
    expect(r.entity_id).toMatch(/^TECH:OPEN:/)
    const composed = adapter.composeProposition(
      slots({ entity_id: r.entity_id, entity_label: r.label }),
      NOW,
    )
    expect(composed.category).toBe('tech')
  })
})

describe('AIRANK camp kinds', () => {
  it('grades camp_rank1 / camp_topn YES when any camp brand meets the condition', () => {
    const brands = [
      { brand: 'DeepSeek' as const, model: 'deepseek-v4', rank: 2, score: null },
      { brand: 'OpenAI' as const, model: 'gpt-6', rank: 1, score: null },
    ]
    const topn = gradeAirankSnapshot(
      { arena: 'text', category: 'overall', kind: 'camp_topn', subject: 'china', param: '3', deadlineYmd: '2026-10-31' },
      { brands, models: [], publishDate: '2026-10-31' },
    )
    expect(topn.verdict).toBe('YES')
    const rank1 = gradeAirankSnapshot(
      { arena: 'text', category: 'overall', kind: 'camp_rank1', subject: 'china', deadlineYmd: '2026-10-31' },
      { brands, models: [], publishDate: '2026-10-31' },
    )
    expect(rank1.verdict).toBe('NO')
    const us = gradeAirankSnapshot(
      { arena: 'text', category: 'overall', kind: 'camp_rank1', subject: 'us', deadlineYmd: '2026-10-31' },
      { brands, models: [], publishDate: '2026-10-31' },
    )
    expect(us.verdict).toBe('YES')
  })

  it('lists unsure-HQ brands under other', () => {
    expect(AIRANK_CAMP_OTHER_BRANDS).toEqual([
      'Cohere',
      'Upstage',
      'NAVER',
      'Leonardo',
      'HiDream',
      'Reve',
      'Sber (Kandinsky)',
    ])
    expect(campOfBrand('Black Forest Labs')).toBe('europe')
    expect(campOfBrand('Mistral')).toBe('europe')
    expect(campOfBrand('Recraft')).toBe('europe')
    expect(campOfBrand('Kuaishou (Kling)')).toBe('china')
  })
})

describe('AIRANK public generate gate', () => {
  const instrument = 'AIRANK:text:overall:brand_rank1:Google:20261031'
  it('accepts AIRANK for KR / US / CN at the same horizons as other non-financial categories', () => {
    for (const viewer of [
      { isAdmin: false, jurisdiction: { ipCountry: 'KR' } },
      { isAdmin: false, jurisdiction: { declaredCountry: 'US', ipCountry: 'US' } },
      { isAdmin: false, jurisdiction: { declaredCountry: 'CN' } },
    ]) {
      for (const horizon of ['1w', '1m', '3m'] as const) {
        expect(gatePublicGenerateInstrument(instrument, viewer, horizon)).toEqual({
          ok: true,
          instrument,
          category: 'ai_models',
          horizon,
        })
      }
    }
  })
})

describe('self-vendor columns replace reasoning_text markers', () => {
  it('strips leftover markers on read', () => {
    expect(stripSelfVendorMarkers('CHAIN\n[self_vendor subject=1 param=0 brand=OpenAI]\nEVIDENCE')).toBe(
      'CHAIN\n\nEVIDENCE',
    )
    expect(parseAirankPrompt('구글이 이번 달 말 AI 1위 할까?', NOW).ok).toBe(true)
  })
})
