import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEAGUE_DEEP_REPORT_CREDITS } from '../credits'
import { renderEvidenceDossier, admitEvidenceClaim } from '../deep-report-dossier'
import {
  DEEP_REPORT_CHAIR,
  DEEP_REPORT_DEBATER_MODELS,
  PROJECTED_DEEP_RESEARCH_USD,
  REMOVED_DEEP_REPORT_MODELS,
  assignDebateSides,
  bilingualResearchQueries,
  deepReportMargin,
  languageLockLine,
  reportStageFor,
  researchPathForCap,
} from '../deep-report-policy'
import { chairUserPrompt, openingUserPrompt, rebuttalUserPrompt } from '../deep-report-prompts'
import { deepReportQueueEstimate } from '../generation/policy'
import { krDeepPolicyForInstrument } from '../korea-lane-features'
import { gatePublicGenerateInstrument } from '../access-policy'
import { leagueSurfaceCopy } from '../i18n/surface-copy'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { getLeagueUiPack } from '../i18n/dictionary'

const REPORT_RUN = readFileSync(resolve('lib/league/deep-report-run.ts'), 'utf8')
const GENERATE = readFileSync(resolve('app/api/league/generate/route.ts'), 'utf8')
const DOORS = readFileSync(resolve('components/league/DeepAnalysis.tsx'), 'utf8')

describe('AI deep report pipeline', () => {
  it('walks research → opening → rebuttal → chair', () => {
    expect(reportStageFor({})).toBe('research')
    expect(reportStageFor({ research: {} })).toBe('opening')
    expect(reportStageFor({ research: {}, openings: [] })).toBe('rebuttal')
    expect(reportStageFor({ research: {}, openings: [], rebuttals: [] })).toBe('chair')
    expect(DEEP_REPORT_DEBATER_MODELS).toHaveLength(6)
    expect(DEEP_REPORT_CHAIR.model).toBe('claude-opus-5-5')
    expect(REPORT_RUN).toContain('bilingualResearchQueries')
    expect(REPORT_RUN).toContain('PERPLEXITY_SONAR_DEEP_RESEARCH_MODEL')
    expect(REPORT_RUN).toContain("model: 'gemini-3.6-flash'")
    expect(REPORT_RUN).toContain("model: 'grok-4.3'")
    expect(REPORT_RUN).toContain("model: 'claude-sonnet-5'")
    expect(REPORT_RUN).toContain("modelOverride: 'claude-opus-5-5'")
    for (const banned of REMOVED_DEEP_REPORT_MODELS) {
      expect(REPORT_RUN).not.toContain(banned)
    }
  })

  it('falls back to standard search when the projected deep bundle exceeds the cap', () => {
    expect(researchPathForCap(1)).toBe('deep')
    expect(PROJECTED_DEEP_RESEARCH_USD).toBeLessThanOrEqual(1)
    expect(researchPathForCap(0.5)).toBe('standard_fallback')
    const dossier = renderEvidenceDossier({
      locale: 'ko',
      category: 'sports',
      findings: [],
      fallback: true,
    })
    expect(dossier).toContain('sonar-deep-research')
    expect(dossier).toContain('없음')
  })

  it('keeps 40-seat votes out of debater prompts and gives them to the chair', () => {
    const opening = openingUserPrompt({
      locale: 'ko',
      proposition: 'BTC finishes higher',
      packet: 'packet',
      dossier: 'dossier',
      side: 'yes',
      model: 'claude-sonnet-5',
    })
    const rebuttal = rebuttalUserPrompt({
      locale: 'ko',
      proposition: 'BTC finishes higher',
      packet: 'packet',
      dossier: 'dossier',
      side: 'no',
      ownOpening: 'open',
      oppositeOpenings: 'opp',
    })
    const chair = chairUserPrompt({
      locale: 'ko',
      proposition: 'BTC finishes higher',
      packet: 'packet',
      dossier: 'dossier',
      openings: 'o',
      rebuttals: 'r',
      fortySeatAggregate: 'n=40. Distribution: up: 25, down: 15.',
      categoryNote: '',
    })
    expect(opening).not.toContain('40-seat')
    expect(opening).not.toContain('predicted_direction')
    expect(rebuttal).not.toContain('40-seat')
    expect(chair).toContain('40-seat aggregate')
    expect(chair).toContain('up: 25')
    expect(opening).toContain(languageLockLine('ko'))
    expect(rebuttal).toContain(languageLockLine('ko'))
    expect(chair).toContain(languageLockLine('ko'))
  })

  it('plans queries in English and the viewer language', () => {
    const ko = bilingualResearchQueries('삼성전자가 오른다', 'ko')
    expect(ko.filter((row) => row.lang === 'en')).toHaveLength(6)
    expect(ko.filter((row) => row.lang === 'ko')).toHaveLength(6)
    expect(ko.some((row) => row.text.includes('최근 30일'))).toBe(true)
    expect(bilingualResearchQueries('AAPL up', 'en').every((row) => row.lang === 'en')).toBe(true)
  })

  it('rotates 3 vs 3 by round id', () => {
    const a = assignDebateSides('round-a')
    const b = assignDebateSides('round-b')
    expect(a.filter((seat) => seat.side === 'yes')).toHaveLength(3)
    expect(a.filter((seat) => seat.side === 'no')).toHaveLength(3)
    expect(a.map((seat) => seat.model)).toEqual(DEEP_REPORT_DEBATER_MODELS.map((seat) => seat.model))
    const same = a.every((seat, i) => seat.side === b[i]?.side)
    expect(same).toBe(false)
  })

  it('drops sports odds and still prices the report at 100', () => {
    expect(admitEvidenceClaim('DraftKings odds -150', 'sports')).toBeNull()
    expect(LEAGUE_DEEP_REPORT_CREDITS).toBe(100)
    const margin = deepReportMargin(1.5, 100)
    expect(margin.revenueUsd).toBeCloseTo(4.75)
    expect(margin.marginUsd).toBeCloseTo(3.25)
    expect(deepReportQueueEstimate({ queuedAhead: 0 }).etaMinutes).toBe(8)
    expect(deepReportQueueEstimate({ queuedAhead: 2 }).position).toBe(3)
  })
})

describe('Korean lane deep report and KR stocks', () => {
  it('allows world-door categories and crypto, and hides finance except crypto', () => {
    expect(krDeepPolicyForInstrument('politics_election', 'ELECTION:kr:1')).toBe('allow')
    expect(krDeepPolicyForInstrument('entertainment_awards', 'SHOW:1')).toBe('allow')
    expect(krDeepPolicyForInstrument('sports', 'MATCH:1')).toBe('allow')
    expect(krDeepPolicyForInstrument('real_estate', 'PROPERTY:1')).toBe('allow')
    expect(krDeepPolicyForInstrument('tech', 'AIRANK:1')).toBe('allow')
    expect(krDeepPolicyForInstrument('ai_models', 'AIRANK:1')).toBe('allow')
    expect(krDeepPolicyForInstrument('crypto_spot', 'BTC/USD')).toBe('allow')
    expect(krDeepPolicyForInstrument('stocks', 'KRSTOCK:KOSPI:005930')).toBe('hide')
    expect(krDeepPolicyForInstrument('stock', 'STOCK:NASDAQ:AAPL')).toBe('hide')
    expect(krDeepPolicyForInstrument('fx', 'EUR/USD')).toBe('hide')
    expect(krDeepPolicyForInstrument('gold_metal', 'XAU/USD')).toBe('hide')
    expect(krDeepPolicyForInstrument('index_etf', 'SPY')).toBe('hide')
    expect(krDeepPolicyForInstrument('commodities_energy', 'WTI/USD')).toBe('hide')
  })

  it('lets a normal user generate a visible KR stock and later viewers reuse the cache_key round', () => {
    const gate = gatePublicGenerateInstrument('KRSTOCK:KOSPI:005930', {
      isAdmin: false,
      jurisdiction: { declaredCountry: 'KR', ipCountry: 'KR' },
    }, '1d', undefined, {
      isKrUniverseVisible: (market, code) => market === 'KOSPI' && code === '005930',
    })
    expect(gate).toMatchObject({ ok: true, instrument: 'KRSTOCK:KOSPI:005930' })
    expect(GENERATE).toContain(".eq('cache_key', target.round.cache_key)")
    expect(DOORS).toContain('deep-report-start')
    expect(DOORS).toContain('deepReport(REPORT_COST)')
  })

  it('has the 100-credit label in every locale', () => {
    for (const locale of LEAGUE_LOCALES) {
      const label = getLeagueUiPack(locale).hub.deepReport(100)
      expect(label).toContain('100')
      expect(label.length).toBeGreaterThan(8)
    }
    expect(getLeagueUiPack('ko').hub.deepReport(100)).toContain('AI 심층 리포트')
    expect(leagueSurfaceCopy('ko').doors.financeTitle).toBe('금융 예측')
  })
})
