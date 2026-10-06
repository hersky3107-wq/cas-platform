import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelTile } from '../../../components/league/ModelTile'
import {
  ANALYSIS_LENS_HEADER,
  FINANCE_LENS_IDS,
  SPORTS_LENS_IDS,
  analysisLensForSeat,
  lensDisplayLabel,
  withAnalysisLens,
} from '../analysis-lenses'
import {
  CONDITIONAL_INSUFFICIENT_N,
  MIN_SESSIONS_SHRINKAGE,
  assembleClosedBookInjection,
  computeConditionalBaseRates,
  shrinkBaseRatePct,
  type ClosedBookPacketInput,
  type SeriesBar,
} from '../closed-book-packet'
import { computeCrowding } from '../crowding'
import { compareLensEras, majorityShare } from '../lens-era-compare'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_ROSTER } from '../roster'
import type { CardModelPrediction } from '../card-types'

const ROOT = join(__dirname, '../../..')

function bars(closes: number[]): SeriesBar[] {
  return closes.map((close, i) => ({
    date: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    close,
  }))
}

function rising(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 100 * 1.001 ** i)
}

describe('analysis lens rotation', () => {
  it('shifts with the round id so one model is not stuck on one lens', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 24; i++) {
      seen.add(analysisLensForSeat({ roundId: `round-${i}`, category: 'stock', modelId: 'gpt-6-astra' }).id)
    }
    expect(seen.size).toBeGreaterThan(1)
    for (const id of seen) expect(FINANCE_LENS_IDS).toContain(id)
  })

  it('gives adjacent roster seats different lenses on the same round', () => {
    const [first, second] = LEAGUE_ROSTER
    const roundId = '11111111-2222-3333-4444-555555555555'
    const a = analysisLensForSeat({ roundId, category: 'stock', modelId: first!.model_id })
    const b = analysisLensForSeat({ roundId, category: 'stock', modelId: second!.model_id })
    expect(a.id).not.toBe(b.id)
  })

  it('uses a sports set for sports and keeps finance off that card', () => {
    const lens = analysisLensForSeat({ roundId: 'sports-round', category: 'sports', modelId: 'gpt-6-astra' })
    expect(SPORTS_LENS_IDS).toContain(lens.id)
    expect(FINANCE_LENS_IDS.includes(lens.id as (typeof FINANCE_LENS_IDS)[number]) && lens.id !== 'base_rate_statistician' && lens.id !== 'risk_review').toBe(false)
  })
})

describe('analysis lens prompts', () => {
  it('tells an official seat to read the packet and not invent disagreement', () => {
    const lens = analysisLensForSeat({ roundId: 'r1', category: 'stock', modelId: 'claude-fable-5' })
    const prompt = withAnalysisLens('PACKET BODY', lens, { scout: false })
    expect(prompt).toContain(`${ANALYSIS_LENS_HEADER} ${lens.en}`)
    expect(prompt).toContain('Read the full packet. Start from this lens, weigh everything, then choose. Do not invent disagreement.')
    expect(prompt.startsWith('PACKET BODY')).toBe(true)
  })

  it('gives scouts the same choose rule without a closed-book packet', () => {
    const lens = analysisLensForSeat({ roundId: 'r1', category: 'fx', modelId: 'gpt-5-search-api' })
    const prompt = withAnalysisLens('SEARCH', lens, { scout: true })
    expect(prompt).toContain(ANALYSIS_LENS_HEADER)
    expect(prompt).toContain('Do not invent disagreement.')
    expect(prompt).not.toContain('Read the full packet.')
  })

  it('is wired onto official prompts and left off extras', () => {
    const orch = readFileSync(join(ROOT, 'lib/league/orchestrator.ts'), 'utf8')
    expect(orch).toContain('withAnalysisLens')
    expect(orch).toContain('analysis_lens: lensId')
    for (const rel of [
      'lib/league/extra/consensus.ts',
      'lib/league/extra/crow.ts',
      'lib/league/extra/sentiment.ts',
      'lib/league/extra/history.ts',
      'lib/league/extra/replay.ts',
      'lib/league/extra/run.ts',
    ]) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      expect(src, rel).not.toContain('ANALYSIS LENS')
      expect(src, rel).not.toContain('analysisLensForSeat')
    }
  })
})

describe('lens tag on the seat tile', () => {
  const model: CardModelPrediction = {
    prediction_id: 'p1',
    model_id: 'gpt-6-astra',
    brand: 'OpenAI',
    model_identifier: 'gpt-6-astra',
    camp: 'us',
    league_tier: 'premier',
    direction: 'up',
    probability: 63,
    magnitude: null,
    qualifierText: null,
    reasoning_snippet: 'Momentum is strong.',
    is_correct: null,
    cost_usd: 0,
    predicted_at: '2026-10-06T00:00:00.000Z',
    analysisLens: 'trend_momentum',
  }

  it('shows 관점 on the Korean tile and a localized tag in every locale', () => {
    const ko = renderToStaticMarkup(
      createElement(ModelTile, { model, t: getLeagueUiPack('ko'), locale: 'ko' }),
    )
    expect(ko).toContain('data-testid="seat-lens"')
    expect(ko).toContain('관점: 추세/모멘텀')
    for (const locale of LEAGUE_LOCALES) {
      const name = lensDisplayLabel(locale, 'trend_momentum')
      const html = renderToStaticMarkup(
        createElement(ModelTile, { model, t: getLeagueUiPack(locale), locale }),
      )
      expect(html, locale).toContain(getLeagueUiPack(locale).modelTile.lensTag(name!))
    }
  })

  it('does not tag an extra seat', () => {
    const html = renderToStaticMarkup(
      createElement(ModelTile, {
        model: { ...model, model_id: 'consensus', league_tier: 'extra', analysisLens: 'trend_momentum' },
        t: getLeagueUiPack('ko'),
        locale: 'ko',
      }),
    )
    expect(html).not.toContain('seat-lens')
    expect(html).not.toContain('관점:')
  })
})

describe('conditional base rate', () => {
  it('uses the same shrink formula and marks a small matching sample', () => {
    const rates = computeConditionalBaseRates(bars(rising(80)), 1)
    const ret = rates.find((rate) => rate.feature === 'return_20d')
    expect(ret).toBeTruthy()
    expect(ret!.rawUpPct).toBe(100)
    expect(ret!.n).toBeGreaterThanOrEqual(CONDITIONAL_INSUFFICIENT_N)
    const shrunk = shrinkBaseRatePct(ret!.rawUpPct, ret!.n, ret!.n)
    expect(ret!.shrunk).toBe(shrunk.shrunk)
    expect(ret!.upPct).toBeCloseTo(shrunk.upPct, 6)
    expect(ret!.upPct).toBeLessThan(ret!.rawUpPct)
    expect(MIN_SESSIONS_SHRINKAGE).toBe(250)

    const short = computeConditionalBaseRates(bars(rising(40)), 1).find((rate) => rate.feature === 'return_20d')
    expect(short!.insufficient).toBe(true)
    expect(short!.n).toBeLessThan(CONDITIONAL_INSUFFICIENT_N)
  })

  it('prints the conditional block and an overextension line on a large 20-day rise', () => {
    const closes = rising(70)
    const last = closes[closes.length - 1]!
    for (let i = 0; i < 20; i++) closes.push(last * 1.01 ** (i + 1))
    const series = bars(closes)
    const input: ClosedBookPacketInput = {
      instrument: 'AAPL',
      category: 'stock',
      horizon: '1w',
      series,
      seriesSource: 'test',
      seriesAsOf: series[series.length - 1]!.date,
      anchorClose: series[series.length - 1]!.close,
      anchorSessionDate: series[series.length - 1]!.date,
      quoteAsOf: series[series.length - 1]!.date,
      consensus: null,
      crypto: null,
      findings: [],
      researchCacheKey: 'k',
      assembledAt: '2026-10-06T00:00:00.000Z',
    }
    const packet = assembleClosedBookInjection(input)
    expect(packet).toContain('CONDITIONAL BASE RATE')
    expect(packet).toMatch(/n=\d+/)
    expect(packet).toMatch(/insufficient sample|shrunk toward 50%/)
    const crowding = computeCrowding(input)
    expect(crowding.up.some((line) => /momentum/.test(line))).toBe(true)
    expect(crowding.down.some((line) => /overextension: 20-session move \+/.test(line))).toBe(true)
  })
})

describe('lens era comparison', () => {
  it('splits hit rate and majority share before vs after, by category, with n', () => {
    expect(majorityShare(['up', 'up', 'up', 'down'])).toBe(0.75)
    const cells = compareLensEras([
      {
        category: 'stock',
        consensusCorrect: true,
        directions: Array.from({ length: 40 }, () => 'up' as const),
        hasLens: false,
      },
      {
        category: 'stock',
        consensusCorrect: false,
        directions: [...Array.from({ length: 24 }, () => 'up' as const), ...Array.from({ length: 16 }, () => 'down' as const)],
        hasLens: true,
      },
      {
        category: 'sports',
        consensusCorrect: true,
        directions: ['yes', 'yes', 'no'],
        hasLens: true,
      },
    ])
    const before = cells.find((cell) => cell.category === 'stock' && cell.era === 'before')
    const after = cells.find((cell) => cell.category === 'stock' && cell.era === 'after')
    expect(before).toMatchObject({ consensusHitRatePct: 100, consensusN: 1, meanMajoritySharePct: 100, spreadN: 1 })
    expect(after).toMatchObject({ consensusHitRatePct: 0, consensusN: 1, meanMajoritySharePct: 60, spreadN: 1 })
    const sports = cells.find((cell) => cell.category === 'sports' && cell.era === 'after')
    expect(sports?.consensusN).toBe(1)
    expect(sports?.meanMajoritySharePct).toBeCloseTo(66.7, 1)
    expect(cells.find((cell) => cell.category === 'sports' && cell.era === 'before')).toBeUndefined()
  })
})
