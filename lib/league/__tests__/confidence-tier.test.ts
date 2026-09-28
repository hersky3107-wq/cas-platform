import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ensembleConfidenceTier } from '../confidence-tier'
import { buildConsensusHero } from '../compliance'
import { ConsensusHero } from '../../../components/league/ConsensusHero'
import { ModelTile } from '../../../components/league/ModelTile'
import { getLeagueUiPack, LEAGUE_UI } from '../i18n/dictionary'
import { sideLabelsFor } from '../side-labels'
import type { ConsensusSummary, CardModelPrediction } from '../card-types'

describe('ensembleConfidenceTier — calibration threshold logic', () => {
  it('classifies confidence < 60% as "close" (접전)', () => {
    expect(ensembleConfidenceTier(0)).toBe('close')
    expect(ensembleConfidenceTier(45)).toBe('close')
    expect(ensembleConfidenceTier(55)).toBe('close')
    expect(ensembleConfidenceTier(58.8)).toBe('close')
    expect(ensembleConfidenceTier(59.9)).toBe('close')
  })

  it('classifies confidence 60% through 75% as "favored" (우세)', () => {
    expect(ensembleConfidenceTier(60)).toBe('favored')
    expect(ensembleConfidenceTier(65)).toBe('favored')
    expect(ensembleConfidenceTier(70)).toBe('favored')
    expect(ensembleConfidenceTier(75)).toBe('favored')
  })

  it('classifies confidence > 75% as "dominant" (압도)', () => {
    expect(ensembleConfidenceTier(75.1)).toBe('dominant')
    expect(ensembleConfidenceTier(80)).toBe('dominant')
    expect(ensembleConfidenceTier(90)).toBe('dominant')
    expect(ensembleConfidenceTier(100)).toBe('dominant')
  })

  it('supports unit scale decimals (e.g. 0.588 -> close, 0.65 -> favored, 0.85 -> dominant)', () => {
    expect(ensembleConfidenceTier(0.588)).toBe('close')
    expect(ensembleConfidenceTier(0.65)).toBe('favored')
    expect(ensembleConfidenceTier(0.85)).toBe('dominant')
  })

  it('returns null for missing or invalid values', () => {
    expect(ensembleConfidenceTier(null)).toBeNull()
    expect(ensembleConfidenceTier(undefined)).toBeNull()
    expect(ensembleConfidenceTier(Number.NaN)).toBeNull()
  })
})

describe('buildConsensusHero — confidence tier integration', () => {
  const baseConsensus: ConsensusSummary = {
    tally: { up: 39, down: 0, flat: 0, abstain: 1 },
    majorityDirection: 'up',
    totalModels: 40,
    respondedModels: 39,
    avgProbability: 56,
    aggregateDirection: 'up',
    aggregateProbability: 58.8,
    aggregateMagnitudePct: null,
  }

  it('sets confidenceTier to "close" and localized label "접전" (KO) / "Close" (EN)', () => {
    const koHero = buildConsensusHero(baseConsensus, '1d', LEAGUE_UI.ko)!
    expect(koHero.kind).toBe('answer')
    if (koHero.kind !== 'answer') return
    expect(koHero.confidenceTier).toBe('close')
    expect(koHero.confidenceTierLabel).toBe('접전')

    const enHero = buildConsensusHero(baseConsensus, '1d', LEAGUE_UI.en)!
    if (enHero.kind !== 'answer') return
    expect(enHero.confidenceTier).toBe('close')
    expect(enHero.confidenceTierLabel).toBe('Close')
  })

  it('sets confidenceTier to "favored" and "우세" at 68% confidence', () => {
    const hero = buildConsensusHero(
      { ...baseConsensus, aggregateProbability: 68 },
      '1d',
      LEAGUE_UI.ko,
    )!
    if (hero.kind !== 'answer') return
    expect(hero.confidenceTier).toBe('favored')
    expect(hero.confidenceTierLabel).toBe('우세')
  })

  it('sets confidenceTier to "dominant" and "압도" at 85% confidence', () => {
    const hero = buildConsensusHero(
      { ...baseConsensus, aggregateProbability: 85 },
      '1d',
      LEAGUE_UI.ko,
    )!
    if (hero.kind !== 'answer') return
    expect(hero.confidenceTier).toBe('dominant')
    expect(hero.confidenceTierLabel).toBe('압도')
  })
})

describe('ConsensusHero UI — renders tier badge', () => {
  const sportsConsensus: ConsensusSummary = {
    tally: { up: 39, down: 0, flat: 0, abstain: 1 },
    majorityDirection: 'up',
    totalModels: 40,
    respondedModels: 39,
    avgProbability: 56,
    aggregateDirection: 'up',
    aggregateProbability: 58.8,
    aggregateMagnitudePct: null,
  }

  const sportsRound = {
    round_id: 'sports-round-1',
    proposition_text: 'Will New York Yankees win vs Boston Red Sox?',
    instrument: 'MATCH:BOS-NYY-20260928',
    category: 'sports',
    horizon: '1d',
    proposition_kind: 'binary_subject_outcome' as const,
    subject_label: 'New York Yankees',
  }

  it('renders "접전" badge in hero for coin-flip 39:0 game', () => {
    const t = getLeagueUiPack('ko')
    const labels = sideLabelsFor(sportsRound, t)
    const html = renderToStaticMarkup(
      createElement(ConsensusHero, {
        consensus: sportsConsensus,
        horizon: '1d',
        t,
        labels,
      }),
    )

    expect(html).toContain('data-testid="consensus-confidence-tier"')
    expect(html).toContain('접전')
    expect(html).toContain('가중 확신 59%')
    expect(html).toContain('(접전)')
  })

  it('renders "Close" badge in English hero', () => {
    const t = getLeagueUiPack('en')
    const labels = sideLabelsFor(sportsRound, t)
    const html = renderToStaticMarkup(
      createElement(ConsensusHero, {
        consensus: sportsConsensus,
        horizon: '1d',
        t,
        labels,
      }),
    )

    expect(html).toContain('data-testid="consensus-confidence-tier"')
    expect(html).toContain('Close')
    expect(html).toContain('Weighted confidence 59%')
    expect(html).toContain('(Close)')
  })
})

describe('ModelTile UI — renders confidence badge per tile', () => {
  const sportsRound = {
    round_id: 'sports-round-1',
    proposition_text: 'Will New York Yankees win vs Boston Red Sox?',
    instrument: 'MATCH:BOS-NYY-20260928',
    category: 'sports',
    horizon: '1d',
    proposition_kind: 'binary_subject_outcome' as const,
    subject_label: 'New York Yankees',
  }

  const yankeesModel: CardModelPrediction = {
    model_id: 'gpt-astra',
    model_identifier: 'gpt-astra-v1',
    brand: 'OpenAI',
    camp: 'us',
    league_tier: 'premier',
    direction: 'yes',
    probability: 55,
    magnitude: null,
    qualifierText: '2-1',
    reasoning_snippet: 'Close matchup with slight edge to Yankees.',
    reasoning_text: null,
    cost_usd: 0.002,
    cost_source: 'billed',
    is_correct: null,
    status: 'complete',
    actual_model: 'gpt-astra',
  }

  it('displays the model confidence badge "55%" on the sports tile', () => {
    const t = getLeagueUiPack('ko')
    const labels = sideLabelsFor(sportsRound, t)
    const html = renderToStaticMarkup(
      createElement(ModelTile, {
        model: yankeesModel,
        t,
        labels,
      }),
    )

    expect(html).toContain('data-testid="model-tile-confidence"')
    expect(html).toContain('55%')
    expect(html).toContain('2-1')
  })
})
