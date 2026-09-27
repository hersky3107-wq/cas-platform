import { describe, expect, it } from 'vitest'
import { emptyTally } from '../card-types'
import {
  buildSportsMarketView,
  fractureFromAgreement,
  SPORTS_UI_BANNED_RE,
} from '../sports-market'
import { getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { consensusMoneySearchHints } from '../extra/consensus'
import { buildHistorySystemPrompt, historyRationaleNeedsRetry } from '../extra/history'

function consensus(over: { up: number; down: number; p: number; dir: 'yes' | 'no' }) {
  return {
    tally: { ...emptyTally(), up: over.up, down: over.down },
    majorityDirection: over.dir,
    totalModels: over.up + over.down,
    respondedModels: over.up + over.down,
    avgProbability: over.p,
    aggregateDirection: over.dir,
    aggregateProbability: over.p,
    aggregateMagnitudePct: null,
    aggregateMagnitudeN: 0,
  }
}

describe('sports market dual-display', () => {
  it('computes ensemble vs baseline divergence and fracture labels', () => {
    const iron = buildSportsMarketView({
      consensus: consensus({ up: 36, down: 4, p: 78, dir: 'yes' }),
      marketBaselinePct: 70,
    })
    expect(iron.ensembleWinPct).toBe(78)
    expect(iron.marketBaselinePct).toBe(70)
    expect(iron.divergencePp).toBe(8)
    expect(iron.agreementPct).toBe(90)
    expect(iron.fracture).toBe('iron')
    expect(fractureFromAgreement(50)).toBe('warn')
    expect(fractureFromAgreement(70)).toBe('none')
  })

  it('sports UI copy never uses 토토/배당/핸디캡/픽/베팅', () => {
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      const blob = [
        pack.sportsMarket.ensembleLabel,
        pack.sportsMarket.marketBaselineLabel,
        pack.sportsMarket.divergenceLabel('+3'),
        pack.sportsMarket.fractureIron,
        pack.sportsMarket.fractureWarn,
        pack.sportsMarket.agreement('90'),
        pack.sportsMarket.consensusSeat,
        pack.sportsMarket.disclaimer,
        pack.disclaimer.sports,
      ].join('\n')
      expect(blob).not.toMatch(SPORTS_UI_BANNED_RE)
    }
  })
})

describe('sports extra-seat redefinition', () => {
  it('consensus seat searches the market baseline, not chart or 배당 language', () => {
    const hints = consensusMoneySearchHints('sports')
    expect(hints).toMatch(/시장 기준선|Pinnacle/)
    expect(hints).toMatch(/NEVER write/)
    expect(hints).not.toMatch(/Polymarket/)
  })

  it('history seat uses H2H + form, not chart patterns', () => {
    const system = buildHistorySystemPrompt('sports')
    expect(system).toContain('맞대결')
    expect(system).toContain('최근 폼')
    expect(system).not.toContain('엘리어트 파동')
    expect(historyRationaleNeedsRetry('맞대결 전적에서 앞선다', 'sports')).toBe(false)
    expect(historyRationaleNeedsRetry('쌍바닥 넥라인 돌파', 'sports')).toBe(true)
  })

  it('renders PredictionCard with sportsMarket, devigged odds baseline, and divergence cleanly', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { createElement } = await import('react')
    const { PredictionCard } = await import('../../../components/league/PredictionCard')
    const { buildCardData } = await import('../card-aggregate')

    const mockRound: any = {
      id: 'mock-sports-round',
      opened_at: '2026-09-27T08:00:00.000Z',
      resolves_at: '2026-09-28T02:00:00.000Z',
      category: 'sports',
      item_type: 'ranked',
      proposition_kind: 'binary_subject_outcome',
      subject_label: 'Los Angeles Dodgers',
      instrument: 'MATCH:baseball_mlb:12345:away:1790535960000:San%20Francisco%20Giants:Los%20Angeles%20Dodgers',
      horizon: '1d',
      resolution_rule: 'Dodgers win official result',
      proposition_text: 'Will Los Angeles Dodgers win the MLB game against San Francisco Giants?',
      anchor_price: null,
      anchor_price_at: null,
      anchor_session_date: null,
      resolution_price: null,
      resolution_session_date: null,
      actual_outcome: null,
      resolved_at: null,
      status: 'pending',
    }

    const mockPredictions: any[] = [
      {
        model_id: 'gpt-4o',
        brand: 'OpenAI',
        model_identifier: 'gpt-4o',
        camp: 'us',
        league_tier: 'premier',
        direction: 'yes',
        probability: 75,
        target_price: null,
        rationale: 'Solid pitching rotation',
        is_correct: null,
        settled_at: null,
      },
      {
        model_id: 'claude-3-5-sonnet',
        brand: 'Anthropic',
        model_identifier: 'claude-3-5-sonnet',
        camp: 'us',
        league_tier: 'premier',
        direction: 'yes',
        probability: 80,
        target_price: null,
        rationale: 'Offensive advantage',
        is_correct: null,
        settled_at: null,
      },
    ]

    const card = buildCardData(mockRound, mockPredictions, [], [])
    card.sportsMarket = {
      ensembleWinPct: 77.5,
      marketBaselinePct: 70.4,
      divergencePp: 7.1,
      agreementPct: 100,
      fracture: 'iron',
    }

    const html = renderToStaticMarkup(createElement(PredictionCard, { initialData: card }))
    expect(html).toContain('Will Los Angeles Dodgers win the MLB game')
    expect(html).toContain('77.5%')
    expect(html).toContain('70.4%')
    expect(html).toContain('Statistical divergence +7.1p')
    expect(html).toContain('Dodgers vs San Francisco Giants')
    expect(html).toContain('Informational analysis only. This is not gambling advice.')
  })
})
