import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtraCompare } from '../../../components/league/ExtraCompare'
import { ModelTile } from '../../../components/league/ModelTile'
import { properNameCasing, restoreAcronymCasing, restoreTechOpenCasing } from '../acronym-casing'
import { buildCardData, type PredictionRow, type RoundRow } from '../card-aggregate'
import { rankedPropositionDisplay } from '../card-header-copy'
import { showsConsensusNoMarket } from '../extra/descriptions'
import {
  buildOpenTechRankedRoundInput,
  formatOpenTechPropositionAllLocales,
  parseOpenTechPrompt,
} from '../gateway/adapters/tech-resolve'
import { getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_LOCALES, type LeagueLocale } from '../i18n/locales'
import { resolveLocalizedProposition } from '../proposition-i18n'
import { sideLabelsFor } from '../side-labels'
import {
  KO_BASE_RATE_GLOSS,
  KO_BASE_RATE_GLOSS_OCCURRENCE,
  baseRateGloss,
  hasWrongBaseRateGloss,
  isPriceBaseRateCategory,
  rationaleTranslationGlossary,
} from '../translation-glossary'

const mocks = vi.hoisted(() => ({ runSingleAiProvider: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/ai/router', () => ({
  runSingleAiProvider: (...args: unknown[]) => mocks.runSingleAiProvider(...args),
}))

const PRICE = ['stock', 'etf_index', 'crypto_spot', 'fx', 'gold_metal', 'commodity_energy', 'memecoin', 'real_estate']
const OCCURRENCE = ['tech', 'politics_election', 'sports', 'entertainment_awards', 'ai_models']
const TRANSLATED: Exclude<LeagueLocale, 'en'>[] = ['ko', 'ja', 'zh-TW', 'fr', 'es', 'ar', 'pt']

describe('category-aware base-rate gloss', () => {
  it('price rounds read 상승 비율, every other round reads 발생 비율', () => {
    for (const category of PRICE) {
      expect(isPriceBaseRateCategory(category), category).toBe(true)
      expect(rationaleTranslationGlossary('ko', category), category).toContain(KO_BASE_RATE_GLOSS)
    }
    for (const category of OCCURRENCE) {
      expect(isPriceBaseRateCategory(category), category).toBe(false)
      const glossary = rationaleTranslationGlossary('ko', category)
      expect(glossary, category).toContain(KO_BASE_RATE_GLOSS_OCCURRENCE)
      expect(glossary, category).not.toContain('상승 비율')
    }
    expect(KO_BASE_RATE_GLOSS_OCCURRENCE).toBe('기저율(과거 같은 기간 발생 비율)')
  })

  it('has both glosses in every translated locale and none for English', () => {
    for (const locale of TRANSLATED) {
      const price = baseRateGloss(locale, 'stock')
      const occurrence = baseRateGloss(locale, 'tech')
      expect(price, locale).toBeTruthy()
      expect(occurrence, locale).toBeTruthy()
      expect(occurrence, locale).not.toBe(price)
      expect(rationaleTranslationGlossary(locale, 'sports'), locale).toContain(occurrence!)
      expect(rationaleTranslationGlossary(locale, 'stock'), locale).toContain(price!)
      expect(hasWrongBaseRateGloss(`x ${price} y`, locale, 'tech'), locale).toBe(true)
      expect(hasWrongBaseRateGloss(`x ${price} y`, locale, 'stock'), locale).toBe(false)
      expect(hasWrongBaseRateGloss(`x ${occurrence} y`, locale, 'tech'), locale).toBe(false)
    }
    expect(baseRateGloss('en', 'tech')).toBeNull()
    expect(rationaleTranslationGlossary('en', 'tech')).toBe('')
  })

  describe('rationale translation', () => {
    beforeEach(() => {
      mocks.runSingleAiProvider.mockReset()
      mocks.runSingleAiProvider.mockResolvedValue({
        text: '[{"id":0,"text":"짧은 기간의 기저율(과거 같은 기간 발생 비율)이 낮다."}]',
        promptTokens: 10,
        completionTokens: 10,
        costUsd: 0,
        model: 'gemini-3.5-flash',
      })
    })

    const source = 'The short-window base rate of official GPU announcements is low.'

    it('sends the occurrence gloss for a tech round', async () => {
      const { translateRoundRationales } = await import('../rationale-i18n')
      await translateRoundRationales(
        [{ predictionId: 'p-tech', text: source }],
        'ko',
        { loadCached: async () => ({ rows: [], error: null }), upsert: async () => ({ error: null }) },
        'tech',
      )
      const system = String(mocks.runSingleAiProvider.mock.calls[0]?.[0]?.systemPrompt ?? '')
      expect(system).toContain(KO_BASE_RATE_GLOSS_OCCURRENCE)
      expect(system).not.toContain(KO_BASE_RATE_GLOSS)
    })

    it('re-translates a cached tech translation that carries the price gloss, keeps it for a stock round', async () => {
      const { sourceHash, translateRoundRationales } = await import('../rationale-i18n')
      const cachedRow = {
        prediction_id: 'p-1',
        translated_text: '짧은 기간의 기저율(과거 같은 기간 상승 비율)이 낮다.',
        source_hash: sourceHash(source),
      }
      const store = { loadCached: async () => ({ rows: [cachedRow], error: null }), upsert: async () => ({ error: null }) }

      const tech = await translateRoundRationales([{ predictionId: 'p-1', text: source }], 'ko', store, 'tech')
      expect(mocks.runSingleAiProvider).toHaveBeenCalledTimes(1)
      expect(tech.translations['p-1']).toContain('발생 비율')

      mocks.runSingleAiProvider.mockClear()
      const stock = await translateRoundRationales([{ predictionId: 'p-1', text: source }], 'ko', store, 'stock')
      expect(mocks.runSingleAiProvider).not.toHaveBeenCalled()
      expect(stock.translations['p-1']).toContain('상승 비율')
    })
  })
})

describe('extras strip: 시장 없음 for the market seat', () => {
  const round: RoundRow = {
    id: 'round-nvda',
    proposition_text: 'NVIDIA, 2026-10-06 이후 2026-10-31까지 새 GPU를 발표할까?',
    category: 'tech',
    color_bucket: 'yellow',
    instrument: 'TECH:OPEN:nvidia:announce:새_gpu:20261031:official_newsroom',
    horizon: '1m',
    resolution_rule: 'official newsroom',
    resolves_at: '2026-10-31T23:59:59.999Z',
    opened_at: '2026-10-06T13:39:23.000Z',
    actual_outcome: null,
    resolved_at: null,
    proposition_kind: 'binary_subject_outcome',
  }
  const row = (over: Partial<PredictionRow>): PredictionRow => ({
    model_id: 'gpt-5.6-sol',
    brand: 'OpenAI',
    camp: 'us',
    league_tier: 'premier',
    predicted_direction: 'no',
    predicted_value: 75,
    reasoning_snippet: 'ok',
    is_correct: null,
    cost_usd: 0.01,
    predicted_at: '2026-10-06T13:40:00.000Z',
    ...over,
  })
  const extra = (model_id: string, over: Partial<PredictionRow> = {}) =>
    row({ model_id, brand: model_id, camp: 'other', league_tier: 'extra', ...over })

  function seatHtml(html: string, id: string): string {
    return new RegExp(`<li[^>]*data-extra-seat="${id}"[^>]*>([\\s\\S]*?)</li>`).exec(html)?.[0] ?? ''
  }

  function strip(rows: PredictionRow[], locale: LeagueLocale = 'ko') {
    const card = buildCardData(round, rows)
    const t = getLeagueUiPack(locale)
    const html = renderToStaticMarkup(
      createElement(ExtraCompare, { models: card.models, consensus: card.consensus, t, labels: sideLabelsFor(card.round, t), category: 'tech' }),
    )
    return { card, t, html }
  }

  it('shows 시장 없음 when the market seat sat out, and keeps 미응답 for other silent seats', () => {
    const { html, t } = strip([
      row({}),
      extra('consensus', { predicted_direction: null, predicted_value: null, reasoning_snippet: '시장이 돈으로 매긴 확률 신호를 찾지 못했습니다.' }),
      extra('sentiment', { predicted_direction: null, predicted_value: null }),
    ])
    const market = seatHtml(html, 'consensus')
    expect(market).toContain('시장 없음')
    expect(market).toContain('data-no-market="true"')
    expect(market).not.toContain(t.modelList.noResponse)
    expect(seatHtml(html, 'sentiment')).toContain(t.modelList.noResponse)
  })

  it('matches the tile: no-market on the tile ⇔ 시장 없음 on the strip, in every locale', () => {
    const rows = [row({}), extra('consensus', { predicted_direction: null, predicted_value: null })]
    for (const locale of LEAGUE_LOCALES) {
      const { card, t, html } = strip(rows, locale)
      expect(t.extraCompare.noMarket.trim(), locale).not.toBe('')
      expect(t.extraCompare.noMarket, locale).not.toBe(t.modelList.noResponse)
      expect(seatHtml(html, 'consensus'), locale).toContain(t.extraCompare.noMarket)
      const market = card.models.find((m) => m.model_id === 'consensus')!
      const tile = renderToStaticMarkup(createElement(ModelTile, { model: market, t, locale, category: 'tech' }))
      expect(tile, locale).toContain('data-testid="consensus-no-market"')
    }
    expect(getLeagueUiPack('ko').extraCompare.noMarket).toBe('시장 없음')
  })

  it('keeps 미응답 when the market seat has no row yet, and shows the side when it priced one', () => {
    const missing = strip([row({}), extra('divination', { predicted_direction: 'no' })])
    expect(seatHtml(missing.html, 'consensus')).toContain(missing.t.modelList.noResponse)
    expect(seatHtml(missing.html, 'consensus')).not.toContain('data-no-market')
    const priced = strip([row({}), extra('consensus', { predicted_direction: 'yes', predicted_value: 61 })])
    expect(seatHtml(priced.html, 'consensus')).not.toContain('시장 없음')
    expect(showsConsensusNoMarket('consensus', null)).toBe(true)
    expect(showsConsensusNoMarket('consensus', 'yes')).toBe(false)
    expect(showsConsensusNoMarket('sentiment', null)).toBe(false)
  })
})

describe('acronym casing in composed propositions', () => {
  it('restores acronyms and brand casing on whole tokens only', () => {
    expect(restoreAcronymCasing('새 gpu')).toBe('새 GPU')
    expect(restoreAcronymCasing('new ai chips and cpus')).toBe('new AI chips and CPUs')
    expect(restoreAcronymCasing('iphone 18 와 rtx5090, h200')).toBe('iPhone 18 와 RTX5090, H200')
    expect(restoreAcronymCasing('Starship')).toBe('Starship')
    expect(restoreAcronymCasing('3단 폴더블')).toBe('3단 폴더블')
    expect(restoreAcronymCasing('새 GPU')).toBe('새 GPU')
    expect(restoreAcronymCasing('aircraft and paint')).toBe('aircraft and paint')
    expect(properNameCasing('rivian')).toBe('Rivian')
    expect(properNameCasing('openai')).toBe('OpenAI')
  })

  it('composes the NVIDIA round with 새 GPU in every locale and in the rule', () => {
    const input = buildOpenTechRankedRoundInput(
      'TECH:OPEN:nvidia:announce:새_gpu:20261031:official_newsroom',
      new Date('2026-10-06T13:39:23Z'),
      'ko',
    )!
    expect(input.proposition_text).toBe('NVIDIA, 2026-10-06 이후 2026-10-31까지 새 GPU를 발표할까?')
    for (const locale of LEAGUE_LOCALES) {
      expect(input.propositions[locale], locale).toContain('새 GPU')
      expect(input.propositions[locale], locale).not.toContain('gpu')
    }
    expect(input.resolution_rule).toContain('announces 새 GPU after')
  })

  it('cases a typed prompt and a subject outside the company catalog', () => {
    const parsed = parseOpenTechPrompt('엔비디아가 이번 달 안에 새 gpu를 발표할까?', new Date('2026-10-06T00:00:00Z'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.claim.object).toBe('새 GPU')
    expect(formatOpenTechPropositionAllLocales(parsed.claim).ko).toContain('새 GPU를')
    const other = buildOpenTechRankedRoundInput(
      'TECH:OPEN:rivian:launch:new_ev:20261031:official_newsroom',
      new Date('2026-10-06T00:00:00Z'),
    )!
    expect(other.subject_label).toBe('Rivian')
    expect(other.proposition_text).toContain('new EV')
  })

  it('fixes rounds already stored in lowercase at display time, and leaves other rounds alone', () => {
    const stored = {
      proposition_text: 'NVIDIA, 2026-10-06 이후 2026-10-31까지 새 gpu를 발표할까?',
      category: 'tech',
      instrument: 'TECH:OPEN:nvidia:announce:새_gpu:20261031:official_newsroom',
      propositions: {
        en: 'Will NVIDIA announce 새 gpu after 2026-10-06 and by 2026-10-31?',
        ko: 'NVIDIA, 2026-10-06 이후 2026-10-31까지 새 gpu를 발표할까?',
        ja: 'NVIDIAは2026-10-06以降2026-10-31までに새 gpuを発表するか？',
      },
    }
    expect(resolveLocalizedProposition(stored, 'ko')).toBe('NVIDIA, 2026-10-06 이후 2026-10-31까지 새 GPU를 발표할까?')
    expect(resolveLocalizedProposition(stored, 'en')).toBe('Will NVIDIA announce 새 GPU after 2026-10-06 and by 2026-10-31?')
    expect(resolveLocalizedProposition(stored, 'ja')).toContain('새 GPUを')
    expect(rankedPropositionDisplay(stored.instrument, stored.proposition_text, 'ko', stored.propositions)).toContain('새 GPU를')
    expect(restoreTechOpenCasing('TECH:OPEN:rivian:launch:new_ev:20261031:official_newsroom', 'Will rivian launch new ev?')).toBe(
      'Will Rivian launch new EV?',
    )
    expect(restoreTechOpenCasing('STOCK:NVDA', 'gpu demand')).toBe('gpu demand')
    expect(resolveLocalizedProposition({ proposition_text: 'Will gpu stocks rise?', category: 'stock', instrument: 'STOCK:NVDA' }, 'en')).toBe(
      'Will gpu stocks rise?',
    )
  })
})
