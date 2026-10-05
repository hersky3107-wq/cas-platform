import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => {
  const chain: Record<string, unknown> = {}
  const fn = () => chain
  chain.select = fn
  chain.eq = fn
  chain.in = fn
  chain.lte = fn
  chain.order = fn
  chain.maybeSingle = () => Promise.resolve({ data: null })
  chain.single = () => Promise.resolve({ data: null })
  chain.upsert = () => Promise.resolve({ error: null })
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [] }).then(resolve)
  return {
    supabaseAdmin: {
      from: () => chain,
    },
  }
})

import { CardHeader } from '../../../components/league/CardHeader'
import { DisclaimerFooter } from '../../../components/league/DisclaimerFooter'
import { ModelTile } from '../../../components/league/ModelTile'
import {
  encodeAirankInstrument,
  airankAllPropositions,
  airankPropositionText,
} from '../ai-ranking/instrument'
import { headerHeadline, nonPriceInstrumentDisplay } from '../card-header-copy'
import { LEAGUE_UI } from '../i18n/dictionary'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { sideLabelsFor } from '../side-labels'
import { divinationConfidenceTier, divinationConfidenceLabel } from '../extra/copy'
import { runHistorySeat } from '../extra/run'
import { visibleLeagueText } from '../visible-disclosure'
import { selectRecentPublicFreeformRounds, type FreeformRecentRow } from '../freeform-recent'
import { resolveLocalizedProposition, leagueShareText } from '../proposition-i18n'
import { isNonFinancialCategory } from '../compliance'
import { toneFor } from '../tone'
import type { CardRoundMeta, HitRateSummary, CardModelPrediction } from '../card-types'

const tone = toneFor('indigo')
const hitRate: HitRateSummary = { resolved: false, correct: null, graded: 0, hitRatePct: null, provisional: true }

function makeRoundMeta(overrides: Partial<CardRoundMeta> = {}): CardRoundMeta {
  return {
    round_id: 'airank-round-1',
    opened_at: '2026-10-04T00:00:00.000Z',
    resolves_at: '2026-11-04T23:59:59.999Z',
    proposition_text: '클로드가 오픈AI보다 높을까?',
    proposition_kind: 'binary_subject_outcome',
    subject_label: 'Anthropic',
    instrument: 'AIRANK:text:coding:brand_above:anthropic:openai:20261104',
    horizon: '1m',
    category: 'ai_models',
    resolution_rule: 'Coding ranking comparison on LMArena',
    color_bucket: 'indigo',
    anchorPrice: null,
    anchorSessionDate: null,
    anchorPriceAt: null,
    livePrice: null,
    livePriceAt: null,
    resolutionPrice: null,
    resolutionSessionDate: null,
    actual_outcome: null,
    resolved_at: null,
    operatorEvidence: null,
    gradingState: 'not_due',
    unresolvableReason: null,
    actualMagnitudePct: null,
    propositions: null,
    ...overrides,
  }
}

describe('airank card fixes & proposition localization', () => {
  describe('1. Side labels per kind/locale (no 실현/불발 for ai_models)', () => {
    it('brand_above produces localized "{subject} ahead" / "{param} ahead" across all 8 locales', () => {
      const instrument = encodeAirankInstrument({
        arena: 'text',
        category: 'coding',
        kind: 'brand_above',
        subject: 'anthropic',
        param: 'openai',
        deadlineYmd: '2026-11-04',
      })
      const round = {
        instrument,
        category: 'ai_models',
        proposition_kind: 'binary_subject_outcome',
        subject_label: 'Anthropic',
      }

      for (const locale of LEAGUE_LOCALES) {
        const t = LEAGUE_UI[locale]
        const labels = sideLabelsFor(round, t, locale)
        expect(labels.namedSides).toBe(true)
        // Must not contain default binary outcome tokens
        const upWord = labels.badge('yes')
        const downWord = labels.badge('no')
        expect(upWord).not.toBe('실현')
        expect(downWord).not.toBe('불발')
        expect(upWord).not.toBe('Occurred')
        expect(downWord).not.toBe('Did not occur')

        if (locale === 'ko') {
          expect(upWord).toBe('앤트로픽이 위')
          expect(downWord).toBe('오픈AI가 위')
        } else if (locale === 'en') {
          expect(upWord).toBe('Anthropic ahead')
          expect(downWord).toBe('OpenAI ahead')
        } else if (locale === 'ja') {
          expect(upWord).toBe('Anthropicが上位')
          expect(downWord).toBe('OpenAIが上位')
        } else if (locale === 'zh-TW') {
          expect(upWord).toBe('Anthropic領先')
          expect(downWord).toBe('OpenAI領先')
        } else if (locale === 'fr') {
          expect(upWord).toBe('Anthropic devant')
          expect(downWord).toBe('OpenAI devant')
        } else if (locale === 'es') {
          expect(upWord).toBe('Anthropic arriba')
          expect(downWord).toBe('OpenAI arriba')
        } else if (locale === 'pt') {
          expect(upWord).toBe('Anthropic à frente')
          expect(downWord).toBe('OpenAI à frente')
        } else if (locale === 'ar') {
          expect(upWord).toBe('Anthropic في المقدمة')
          expect(downWord).toBe('OpenAI في المقدمة')
        }
      }
    })

    it('rank1 (brand_rank1, model_rank1, camp_rank1) produces "1위 함" / "1위 못 함" across all 8 locales', () => {
      const cases = [
        { kind: 'brand_rank1' as const, subject: 'Anthropic' },
        { kind: 'model_rank1' as const, subject: 'claude-3-7-sonnet' },
        { kind: 'camp_rank1' as const, subject: 'us' },
      ]
      for (const { kind, subject } of cases) {
        const instrument = encodeAirankInstrument({
          arena: 'text',
          category: 'coding',
          kind,
          subject,
          deadlineYmd: '2026-11-04',
        })
        const round = {
          instrument,
          category: 'ai_models',
          proposition_kind: 'binary_subject_outcome',
          subject_label: 'Anthropic',
        }

        for (const locale of LEAGUE_LOCALES) {
          const t = LEAGUE_UI[locale]
          const labels = sideLabelsFor(round, t, locale)
          expect(labels.namedSides).toBe(false)
          const upWord = labels.badge('yes')
          const downWord = labels.badge('no')
          expect(upWord).not.toBe('실현')
          expect(downWord).not.toBe('불발')

          if (locale === 'ko') {
            expect(upWord).toBe('1위 함')
            expect(downWord).toBe('1위 못 함')
          } else if (locale === 'en') {
            expect(upWord).toBe('#1')
            expect(downWord).toBe('Not #1')
          } else if (locale === 'ja') {
            expect(upWord).toBe('1位達成')
            expect(downWord).toBe('1位ならず')
          } else if (locale === 'zh-TW') {
            expect(upWord).toBe('第1名')
            expect(downWord).toBe('未獲第1')
          }
        }
      }
    })

    it('topn (brand_topn, camp_topn) produces "{N}위 안" / "{N}위 밖" across all 8 locales', () => {
      const cases = [
        { kind: 'brand_topn' as const, subject: 'Anthropic' },
        { kind: 'camp_topn' as const, subject: 'us' },
      ]
      for (const { kind, subject } of cases) {
        const instrument = encodeAirankInstrument({
          arena: 'text',
          category: 'coding',
          kind,
          subject,
          param: 3,
          deadlineYmd: '2026-11-04',
        })
        const round = {
          instrument,
          category: 'ai_models',
          proposition_kind: 'binary_subject_outcome',
          subject_label: 'Anthropic',
        }

        for (const locale of LEAGUE_LOCALES) {
          const t = LEAGUE_UI[locale]
          const labels = sideLabelsFor(round, t, locale)
          expect(labels.namedSides).toBe(false)
          const upWord = labels.badge('yes')
          const downWord = labels.badge('no')
          expect(upWord).not.toBe('실현')
          expect(downWord).not.toBe('불발')

          if (locale === 'ko') {
            expect(upWord).toBe('3위 안')
            expect(downWord).toBe('3위 밖')
          } else if (locale === 'en') {
            expect(upWord).toBe('Top 3')
            expect(downWord).toBe('Outside top 3')
          } else if (locale === 'ja') {
            expect(upWord).toBe('3位以内')
            expect(downWord).toBe('3位圏外')
          } else if (locale === 'zh-TW') {
            expect(upWord).toBe('前3名')
            expect(downWord).toBe('前3名以外')
          }
        }
      }
    })
  })

  describe('2. Card header formatting for ai_models', () => {
    it('formats brand_above header cleanly without raw "ai models" or "1m"', () => {
      const meta = makeRoundMeta({
        instrument: 'AIRANK:text:coding:brand_above:anthropic:openai:20261104',
        horizon: '1m',
        category: 'ai_models',
      })

      const koDisplay = nonPriceInstrumentDisplay(meta.instrument, 'ko', meta.horizon, LEAGUE_UI.ko)
      expect(koDisplay).toBe('클로드가 이번 달 말 코딩 순위에서 GPT보다 위일까?')

      const enDisplay = nonPriceInstrumentDisplay(meta.instrument, 'en', meta.horizon, LEAGUE_UI.en)
      expect(enDisplay).toBe('Will Anthropic rank above OpenAI in coding by the end of this month?')

      const koHeadline = headerHeadline({
        roundDate: '2026-10-04',
        instrument: meta.instrument,
        anchorPrice: null,
        anchorSessionDate: null,
        propositionKind: meta.proposition_kind,
        subjectLabel: meta.subject_label,
        propositionText: meta.proposition_text,
        horizon: meta.horizon,
        locale: 'ko',
        t: LEAGUE_UI.ko,
      })
      expect(koHeadline).toContain('클로드가 이번 달 말 코딩 순위에서 GPT보다 위일까?')

      const markup = renderToStaticMarkup(
        createElement(CardHeader, {
          round: meta,
          tone,
          hitRate,
          locale: 'ko',
        }),
      )
      // Must not render raw unformatted horizon/category like "1m · ai models"
      expect(markup).not.toContain('ai models')
      expect(markup).not.toMatch(/1m\s*·\s*ai models/)
      expect(markup).toContain('클로드가 이번 달 말 코딩 순위에서 GPT보다 위일까?')
      expect(markup).toContain('채점 기준: 마감일 이후 처음 발표되는 LMArena 공개 순위')
      expect(markup).not.toContain('AIRANK:')
    })

    it('formats topn and rank1 headers cleanly', () => {
      const topnMeta = makeRoundMeta({
        instrument: 'AIRANK:text:coding:brand_topn:anthropic:3:20261104',
        horizon: '1m',
        category: 'ai_models',
      })
      expect(nonPriceInstrumentDisplay(topnMeta.instrument, 'ko', topnMeta.horizon, LEAGUE_UI.ko)).toBe(
        '클로드가 이번 달 말 코딩 순위에서 3위 안에 들까?',
      )
      expect(nonPriceInstrumentDisplay(topnMeta.instrument, 'en', topnMeta.horizon, LEAGUE_UI.en)).toBe(
        'Will Anthropic finish in the top 3 in coding by the end of this month?',
      )

      const rank1Meta = makeRoundMeta({
        instrument: 'AIRANK:text:coding:brand_rank1:anthropic:20261104',
        horizon: '1m',
        category: 'ai_models',
      })
      expect(nonPriceInstrumentDisplay(rank1Meta.instrument, 'ko', rank1Meta.horizon, LEAGUE_UI.ko)).toBe(
        '클로드가 이번 달 말 코딩 순위에서 1위일까?',
      )
      expect(nonPriceInstrumentDisplay(rank1Meta.instrument, 'en', rank1Meta.horizon, LEAGUE_UI.en)).toBe(
        'Will Anthropic be #1 in coding by the end of this month?',
      )
    })
  })

  describe('3. Disclaimers: non-financial neutral footer vs financial disclaimers', () => {
    it('classifies non-financial categories correctly', () => {
      expect(isNonFinancialCategory('ai_models')).toBe(true)
      expect(isNonFinancialCategory('tech')).toBe(true)
      expect(isNonFinancialCategory('sports')).toBe(true)
      expect(isNonFinancialCategory('entertainment')).toBe(true)
      expect(isNonFinancialCategory('politics_election')).toBe(true)
      expect(isNonFinancialCategory('real_estate')).toBe(true)

      expect(isNonFinancialCategory('stocks')).toBe(false)
      expect(isNonFinancialCategory('kr_stock')).toBe(false)
      expect(isNonFinancialCategory('crypto')).toBe(false)
      expect(isNonFinancialCategory('forex')).toBe(false)
      expect(isNonFinancialCategory('gold_metal')).toBe(false)
    })

    it('renders neutral reference footer for ai_models and omits financial warning', () => {
      const koHtml = renderToStaticMarkup(
        createElement(DisclaimerFooter, {
          category: 'ai_models',
          t: LEAGUE_UI.ko,
          tone,
        }),
      )
      expect(koHtml).toContain('AI 모델들의 예측을 비교하는 참고 자료이며 결과를 보장하지 않습니다.')
      expect(koHtml).not.toContain('원금손실')
      expect(koHtml).not.toContain('투자자문')
      expect(koHtml).not.toContain('매매')
      expect(koHtml).toContain('data-testid="disclaimer-non-financial"')

      const enHtml = renderToStaticMarkup(
        createElement(DisclaimerFooter, {
          category: 'ai_models',
          t: LEAGUE_UI.en,
          tone,
        }),
      )
      expect(enHtml).toContain('Reference material comparing AI model forecasts; results are not guaranteed.')
      expect(enHtml).not.toContain('investment advice')
      expect(enHtml).not.toContain('loss of capital')
    })

    it('keeps financial disclaimer unchanged for financial categories', () => {
      const html = renderToStaticMarkup(
        createElement(DisclaimerFooter, {
          category: 'stocks',
          t: LEAGUE_UI.ko,
          tone: toneFor('red'), // prominent shows t.disclaimer.long
        }),
      )
      expect(html).toContain('투자·금융·법률·전문 자문이 아닙니다')
      expect(html).not.toContain('data-testid="disclaimer-non-financial"')
    })

    it('CardHeader suppresses KrDataNotice for non-financial category', () => {
      const meta = makeRoundMeta({
        category: 'ai_models',
      })
      const markup = renderToStaticMarkup(
        createElement(CardHeader, {
          round: meta,
          tone,
          hitRate,
          locale: 'ko',
          koreaLaneViewer: true,
        }),
      )
      // Must not render KRX price disclaimer notice
      expect(markup).not.toContain('한국거래소(KRX) 제공 시세')
      expect(markup).not.toContain('투자 참고용')
    })
  })

  describe('4. Extras on ai_models: rank series & divination confidence', () => {
    it('runHistorySeat abstains silently with null reasoning_snippet when rank series is unavailable', async () => {
      const round = {
        id: 'airank-round-1',
        instrument: 'AIRANK:text:coding:brand_above:anthropic:openai:20261104',
        category: 'ai_models',
        horizon: '1m',
        opened_at: '2026-10-04T00:00:00.000Z',
      }
      const seat = await runHistorySeat(round, vi.fn(), null)
      expect(seat.status).toBe('abstain')
      expect(seat.reasoning_snippet).toBeNull()
      // Never show "price series" to users
      expect(seat.reasoning_snippet).not.toBe('과거 가격 추세 데이터가 없어 중립으로 판정합니다.')
    })

    it('divination confidence tier maps letters to qualitative tiers or hides', () => {
      expect(divinationConfidenceTier('A')).toBe('strong')
      expect(divinationConfidenceTier('A+')).toBe('strong')
      expect(divinationConfidenceTier('STRONG')).toBe('strong')
      expect(divinationConfidenceTier('B')).toBe('moderate')
      expect(divinationConfidenceTier('MODERATE')).toBe('moderate')
      expect(divinationConfidenceTier('C')).toBe('weak')
      expect(divinationConfidenceTier('WEAK')).toBe('weak')
      expect(divinationConfidenceTier('Z')).toBeNull()
      expect(divinationConfidenceTier('X')).toBeNull()
      expect(divinationConfidenceTier(null)).toBeNull()
      expect(divinationConfidenceTier(undefined)).toBeNull()
    })

    it('divination confidence label formats qualitative copy or null', () => {
      expect(divinationConfidenceLabel('A', LEAGUE_UI.ko)).toBe('강한 점괘')
      expect(divinationConfidenceLabel('A', LEAGUE_UI.en)).toBe('Strong reading')
      expect(divinationConfidenceLabel('B', LEAGUE_UI.ko)).toBe('보통 점괘')
      expect(divinationConfidenceLabel('C', LEAGUE_UI.ko)).toBe('약한 점괘')
      expect(divinationConfidenceLabel('Z', LEAGUE_UI.ko)).toBeNull()
    })

    it('ModelTile never displays divination raw letter "A" as magnitude badge', () => {
      const divinationModel: CardModelPrediction = {
        model_id: 'divination_consult',
        display_name: 'Divination',
        brand: 'Divination',
        model_name: 'Consult',
        league_tier: 'specialist',
        avatar_url: null,
        direction: 'up',
        probability: null,
        predicted_magnitude_pct: null,
        qualifierText: 'A',
        status: 'completed',
        reasoning_snippet: 'Forecast rationale',
      }
      const markup = renderToStaticMarkup(
        createElement(ModelTile, {
          model: divinationModel,
          t: LEAGUE_UI.ko,
        }),
      )
      // Must not render magnitude badge "A"
      expect(markup).not.toContain('>A<')
      expect(markup).not.toContain('class="magnitude">A</span>')
    })
  })

  describe('5. Display scrub for ai_models and generic rules', () => {
    it('scrubs Elo and score numbers in all forms', () => {
      const samples = [
        '~1582 vs ~1500',
        '1552>1543',
        '1552 > 1543',
        '1552 vs 1543',
        'Elo 1450',
        '1450 Elo',
        '엘로 1450',
        'score 1,312',
        'score: 1312',
        '점수 1,312',
      ]
      for (const sample of samples) {
        const scrubbed = visibleLeagueText('ai_models', `Analysis shows ${sample} clearly.`)
        expect(scrubbed).not.toContain(sample)
      }
    })

    it('scrubs bare and parenthesized domains across all categories', () => {
      const text = 'Data reported by (benchleader.com) and also benchleader.com directly.'
      const scrubbed = visibleLeagueText('ai_models', text)
      expect(scrubbed).not.toContain('benchleader.com')
      expect(scrubbed).not.toContain('(benchleader.com)')

      const stocksText = 'Check info at (marketwatch.com) or reuters.com now.'
      const stocksScrubbed = visibleLeagueText('stocks', stocksText)
      expect(stocksScrubbed).not.toContain('marketwatch.com')
      expect(stocksScrubbed).not.toContain('reuters.com')
    })

    it('scrubs link residue and markdown URLs', () => {
      const text = 'See the documentation [](/benchmarks) and [leaderboard](https://arena.lmsys.org) now.'
      const scrubbed = visibleLeagueText('ai_models', text)
      expect(scrubbed).not.toContain('[](/benchmarks)')
      expect(scrubbed).not.toContain('https://arena.lmsys.org')
      expect(scrubbed).toContain('leaderboard')
    })

    it('scrubs citation markers', () => {
      const text = 'OpenAI released GPT-4.5 [1] with high performance [14] and confirmed 【2】 in testing.'
      const scrubbed = visibleLeagueText('ai_models', text)
      expect(scrubbed).not.toContain('[1]')
      expect(scrubbed).not.toContain('[14]')
      expect(scrubbed).not.toContain('【2】')
    })
  })

  describe('6. Proposition localization & zh-TW recent list', () => {
    it('client proposition-i18n has no server or lib/ai imports', () => {
      const src = readFileSync(join(__dirname, '../proposition-i18n.ts'), 'utf8')
      expect(src).not.toMatch(/@\/lib\/ai/)
      expect(src).not.toMatch(/supabase\/server/)
      expect(src).not.toMatch(/runSingleAiProvider/)
      expect(src).not.toMatch(/from ['"]node:/)
      expect(src).not.toContain("import 'server-only'")
    })

    it('renders AIRANK stored audit propositions from codec for all 8 locales without LLM', () => {
      const parts = {
        arena: 'text' as const,
        category: 'coding',
        kind: 'brand_above' as const,
        subject: 'anthropic',
        param: 'openai',
        deadlineYmd: '2026-11-04',
      }
      const props = airankAllPropositions(parts)
      for (const loc of LEAGUE_LOCALES) {
        expect(props[loc]).toBeDefined()
        expect(props[loc].length).toBeGreaterThan(0)
      }

      expect(props.ko).toBe('클로드가 2026-11-04 이후 처음 발표되는 LMArena 코딩 순위에서 오픈AI보다 위일까?')
      expect(props.en).toBe('Will Anthropic rank above OpenAI on the first LMArena coding ranking published on or after 2026-11-04?')
      expect(props['zh-TW']).toBe('Anthropic在2026-11-04之後首次發布的LMArena 程式編寫排名中會排在OpenAI之前嗎？')
      expect(props.ja).toBe('Anthropicは2026-11-04以降に最初に発表されるLMArena コーディングランキングでOpenAIより上位になるか？')
    })

    it('zh-TW recent list shows Chinese proposition from airank instrument', () => {
      const instrument = 'AIRANK:text:coding:brand_above:anthropic:openai:20261104'
      const rows: FreeformRecentRow[] = [
        {
          id: 'round-tw-1',
          instrument,
          proposition_text: 'Anthropic이 OpenAI보다 높을까?',
          resolves_at: '2026-11-04T23:59:59.999Z',
          category: 'ai_models',
          created_at: '2026-10-04T00:00:00.000Z',
          cache_key: `airank|${instrument}|1m`,
          propositions: null,
        },
      ]

      const recent = selectRecentPublicFreeformRounds(
        rows,
        new Set(['round-tw-1']),
        new Date('2026-10-04T00:00:00.000Z'),
        6,
        'zh-TW',
      )
      expect(recent).toHaveLength(1)
      expect(recent[0].proposition_text).toBe('Anthropic在本月底程式編寫排名會高於OpenAI嗎？')
      expect(recent[0].proposition_text).not.toMatch(/LMArena/)
    })

    it('resolveLocalizedProposition and leagueShareText respect viewer locale and fallbacks', () => {
      const roundWithStoredProps = {
        category: 'tech',
        instrument: 'TECH:OPEN:apple:release:m5_chip:20261104:official_newsroom',
        proposition_text: 'Will Apple release M5 chip by 2026-11-04?',
        propositions: {
          ko: '애플이 2026-11-04까지 M5 칩을 출시할까?',
          en: 'Will Apple release M5 chip by 2026-11-04?',
          'zh-TW': 'Apple會在2026-11-04之前發佈M5 chip嗎？',
        },
      }

      expect(resolveLocalizedProposition(roundWithStoredProps, 'zh-TW')).toBe('Apple會在2026-11-04之前發佈M5 chip嗎？')
      expect(resolveLocalizedProposition(roundWithStoredProps, 'ko')).toBe('애플이 2026-11-04까지 M5 칩을 출시할까?')
      // fr is missing in stored propositions -> falls back to en
      expect(resolveLocalizedProposition(roundWithStoredProps, 'fr')).toBe('Will Apple release M5 chip by 2026-11-04?')

      expect(leagueShareText(roundWithStoredProps, 'zh-TW')).toBe('Apple會在2026-11-04之前發佈M5 chip嗎？')
    })
  })
})
