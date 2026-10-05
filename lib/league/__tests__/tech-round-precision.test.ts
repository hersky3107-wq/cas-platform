import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { answerContractFor } from '../answer-contract'
import { CardHeader } from '@/components/league/CardHeader'
import { ModelTile } from '@/components/league/ModelTile'
import { BRAND_TABLE_FIELDS } from '../ai-ranking/brand-table'
import { brandTableCopy } from '../ai-ranking/brand-table-copy'
import { AIRANK_ARENA_CATEGORIES, fieldLabel } from '../ai-ranking/instrument'
import type { CardModelPrediction, CardRoundMeta, HitRateSummary } from '../card-types'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { getLeagueUiPack, LEAGUE_UI } from '../i18n/dictionary'
import { normalizeChosenSideProbability } from '../probability-normalize'
import { parsePrediction } from '../prediction-parse'
import { sideLabelsFor } from '../side-labels'
import { techCardHeaderLine, techVerbPair } from '../tech-labels'
import { formatOpenTechPropositionAllLocales, openTechResolutionRule } from '../gateway/adapters/tech-resolve'
import { isBroadTechObject } from '../gateway/adapters/tech-object'
import { toneFor } from '../tone'

const OPEN_CLAIM = {
  subject: 'NVIDIA',
  subjectLabel: 'NVIDIA',
  event: 'announce' as const,
  object: '새 GPU 제품 공식 발표 — 데이터센터·소비자 포함, 이미 발표된 제품의 출시·재공지는 제외',
  deadline: '2026-10-31',
  windowStart: '2026-10-04',
  horizon: '1m' as const,
  verification: 'official_newsroom' as const,
  instrument: 'TECH:OPEN:nvidia:announce:new_gpu:20261031:official_newsroom',
  korean: true,
  catalogCompanyId: 'NVDA',
}

const HIT: HitRateSummary = { resolved: false, correct: null, graded: 0, hitRatePct: null, provisional: true }

function techRound(): CardRoundMeta {
  return {
    round_id: 'r-tech',
    proposition_text: '엔비디아, 2026-10-04 이후 2026-10-31까지 새 GPU를 발표할까?',
    category: 'tech',
    color_bucket: 'green',
    instrument: OPEN_CLAIM.instrument,
    horizon: '1m',
    resolution_rule: openTechResolutionRule({ ...OPEN_CLAIM, korean: false }),
    resolves_at: '2026-10-31T23:59:59.999Z',
    opened_at: '2026-10-04T03:00:00.000Z',
    actual_outcome: null,
    resolved_at: null,
    proposition_kind: 'binary_subject_outcome',
    subject_label: 'NVIDIA',
    anchorPrice: null,
    livePrice: null,
    livePriceAt: null,
    anchorSessionDate: null,
    anchorPriceAt: null,
    resolutionSessionDate: null,
    resolutionPrice: null,
    unresolvableReason: null,
    operatorEvidence: null,
    gradingState: 'not_due',
    actualMagnitudePct: null,
    propositions: null,
  }
}

describe('tech window + object', () => {
  it('every locale names the open date and the deadline', () => {
    const all = formatOpenTechPropositionAllLocales(OPEN_CLAIM)
    expect(Object.keys(all).sort()).toEqual([...LEAGUE_LOCALES].sort())
    for (const loc of LEAGUE_LOCALES) {
      expect(all[loc], loc).toContain('2026-10-04')
      expect(all[loc], loc).toContain('2026-10-31')
    }
    expect(all.ko).toBe(
      'NVIDIA, 2026-10-04 이후 2026-10-31까지 새 GPU 제품 공식 발표 — 데이터센터·소비자 포함, 이미 발표된 제품의 출시·재공지는 제외를 발표할까?',
    )
    expect(openTechResolutionRule({ ...OPEN_CLAIM, korean: false })).toMatch(/Events dated before 2026-10-04 do not count/)
  })

  it('treats gpu/phone/product as too broad to grade without a pin', () => {
    expect(isBroadTechObject('새 gpu')).toBe(true)
    expect(isBroadTechObject('new GPU')).toBe(true)
    expect(isBroadTechObject('Starship')).toBe(false)
    expect(isBroadTechObject('Rubin')).toBe(false)
  })
})

describe('chosen-side probability', () => {
  it('keeps 50–100, flips below 50, and leaves an exact 50', () => {
    expect(normalizeChosenSideProbability(72)).toEqual({ probability: 72, probabilityFlipped: false })
    expect(normalizeChosenSideProbability(50)).toEqual({ probability: 50, probabilityFlipped: false })
    expect(normalizeChosenSideProbability(22)).toEqual({ probability: 78, probabilityFlipped: true })
    expect(normalizeChosenSideProbability(null)).toEqual({ probability: null, probabilityFlipped: false })
  })

  it('Haiku-style NO + 22% is stored as 78 with probability_flipped', () => {
    const c = answerContractFor('binary_subject_outcome')
    const parsed = c.parse(
      '{"side":"no","probability":22,"qualifier":"already announced in June","rationale":"June GPUs already count.","strongest_counter":"A new SKU could still land."}',
    )
    expect(parsed?.side).toBe('no')
    expect(parsed?.probability).toBe(78)
    expect(parsed?.probabilityFlipped).toBe(true)
  })

  it('close-higher parser flips a chosen-side 22 the same way', () => {
    const parsed = parsePrediction('{"direction":"down","probability":22,"magnitude":-1.2,"rationale":"Fade the run."}')
    expect(parsed?.direction).toBe('down')
    expect(parsed?.probability).toBe(78)
    expect(parsed?.probabilityFlipped).toBe(true)
  })

  it('every binary contract prompt says 50–100 chosen-side confidence', () => {
    for (const kind of ['binary_close_higher', 'binary_subject_outcome', 'binary_threshold'] as const) {
      const p = answerContractFor(kind).closedBookSystemPrompt
      expect(p).toContain('confidence that YOUR chosen side happens, integer 50 through 100')
    }
  })
})

describe('tech verb labels + header', () => {
  it('uses announce/release pairs in all 8 locales, never 실현/불발', () => {
    for (const loc of LEAGUE_LOCALES) {
      const announce = techVerbPair('announce', loc)
      const release = techVerbPair('release', loc)
      expect(announce.yes.length).toBeGreaterThan(0)
      expect(announce.no.length).toBeGreaterThan(0)
      expect(release.yes).not.toBe(announce.yes)
      expect(`${announce.yes}${announce.no}`).not.toMatch(/실현|불발/)
    }
    expect(techVerbPair('announce', 'ko')).toEqual({ yes: '발표함', no: '발표 안 함', noun: '발표 여부' })
    expect(techVerbPair('announce', 'en')).toEqual({ yes: 'Announces', no: "Doesn't", noun: 'announce' })
  })

  it('side labels for an OPEN announce instrument are verb words', () => {
    const labels = sideLabelsFor(
      { category: 'tech', instrument: OPEN_CLAIM.instrument, subject_label: 'NVIDIA', proposition_kind: 'binary_subject_outcome' },
      getLeagueUiPack('ko'),
      'ko',
    )
    expect(labels.badge('yes')).toBe('발표함')
    expect(labels.badge('no')).toBe('발표 안 함')
    expect(labels.badge('yes')).not.toContain('NVIDIA')
  })

  it('card header is subject · verb 여부 · horizon, never raw tech', () => {
    expect(techCardHeaderLine({ subject: 'NVIDIA', event: 'announce', horizonLabel: '1개월', locale: 'ko' })).toBe(
      'NVIDIA · 발표 여부 · 1개월',
    )
    const html = renderToStaticMarkup(
      createElement(CardHeader, { round: techRound(), hitRate: HIT, tone: toneFor('green'), locale: 'ko' }),
    )
    expect(html).toContain('NVIDIA · 발표 여부 · 1개월')
    expect(html).not.toMatch(/· tech/)
  })
})

describe('extras — silent history + no letter-grade confidence', () => {
  it('divination never paints a letter A/B/C as confidence', () => {
    const model: CardModelPrediction = {
      prediction_id: 'p1',
      model_id: 'divination',
      brand: '점술',
      model_identifier: 'divination',
      camp: 'other',
      league_tier: 'extra',
      direction: 'no',
      probability: null,
      magnitude: null,
      qualifierText: 'B',
      reasoning_snippet: '괘.',
      is_correct: null,
      cost_usd: 0,
      predicted_at: '2026-10-04T03:00:00.000Z',
    }
    const html = renderToStaticMarkup(createElement(ModelTile, { model, t: LEAGUE_UI.ko }))
    expect(html).toContain('보통 점괘')
    expect(html).not.toMatch(/>B</)
    expect(html).not.toContain('>A<')
    expect(html).not.toContain('>C<')
  })
})

describe('AIRANK monthly brand_table fields', () => {
  it('adds webdev, agent, reasoning as monthly-only fields with 8-locale labels', () => {
    expect(BRAND_TABLE_FIELDS.map((f) => f.id)).toEqual([
      'overall',
      'coding',
      'math',
      'writing',
      'image',
      'video',
      'webdev',
      'agent',
      'reasoning',
    ])
    expect(AIRANK_ARENA_CATEGORIES.agent).toEqual(['overall'])
    const webdev = BRAND_TABLE_FIELDS.find((f) => f.id === 'webdev')!
    const agent = BRAND_TABLE_FIELDS.find((f) => f.id === 'agent')!
    const reasoning = BRAND_TABLE_FIELDS.find((f) => f.id === 'reasoning')!
    expect(webdev).toEqual({ id: 'webdev', arena: 'webdev', category: 'overall' })
    expect(agent).toEqual({ id: 'agent', arena: 'agent', category: 'overall' })
    expect(reasoning).toEqual({ id: 'reasoning', arena: 'text', category: 'hard_prompts' })
    for (const loc of LEAGUE_LOCALES) {
      const copy = brandTableCopy(loc)
      expect(copy.fields.webdev.length).toBeGreaterThan(0)
      expect(copy.fields.agent.length).toBeGreaterThan(0)
      expect(copy.fields.reasoning.length).toBeGreaterThan(0)
      expect(fieldLabel({ arena: 'webdev', category: 'overall', kind: 'brand_table', subject: 'top10', deadlineYmd: '2026-10-31' }, loc)).toBeTruthy()
      expect(fieldLabel({ arena: 'agent', category: 'overall', kind: 'brand_table', subject: 'top10', deadlineYmd: '2026-10-31' }, loc)).toBeTruthy()
      expect(fieldLabel({ arena: 'text', category: 'hard_prompts', kind: 'brand_table', subject: 'top10', deadlineYmd: '2026-10-31' }, loc)).toBeTruthy()
    }
    expect(brandTableCopy('ko').fields.webdev).toBe('웹개발')
    expect(brandTableCopy('ko').fields.agent).toBe('에이전트')
    expect(brandTableCopy('ko').fields.reasoning).toBe('추론')
  })
})
