import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ExtraCompare } from '../../../components/league/ExtraCompare'
import { PredictionAxes } from '../../../components/league/PredictionAxes'
import { buildCardData, type PredictionRow, type RoundRow } from '../card-aggregate'
import { getLeagueUiPack } from '../i18n/dictionary'
import { sideLabelsFor } from '../side-labels'
import { emptyTally } from '../card-types'

function round(): RoundRow {
  return {
    id: 'round-extra-compare',
    proposition_text: 'Will AAPL close higher 24h from now?',
    category: 'stock',
    color_bucket: 'green',
    instrument: 'AAPL',
    horizon: '1d',
    resolution_rule: 'NASDAQ regular-session close',
    resolves_at: '2026-08-17T15:31:00.000Z',
    opened_at: '2026-08-16T21:30:00.000Z',
    actual_outcome: null,
    resolved_at: null,
  }
}

function pred(overrides: Partial<PredictionRow>): PredictionRow {
  return {
    model_id: 'gpt-5.6-sol',
    brand: 'OpenAI',
    camp: 'us',
    league_tier: 'premier',
    predicted_direction: 'up',
    predicted_value: 70,
    reasoning_snippet: 'ok',
    is_correct: null,
    cost_usd: 0.01,
    predicted_at: '2026-08-16T21:31:00.000Z',
    ...overrides,
  }
}

describe('ExtraCompare render', () => {
  const t = getLeagueUiPack('ko')

  it('renders crowd vs extra chips and the pending-record placeholder', () => {
    const card = buildCardData(round(), [
      pred({}),
      pred({
        model_id: 'divination',
        brand: '🔮 점술',
        camp: 'other',
        league_tier: 'extra',
        predicted_direction: 'down',
        predicted_value: 38,
      }),
      pred({
        model_id: 'sentiment',
        brand: '📰 심리·내러티브',
        camp: 'other',
        league_tier: 'extra',
        predicted_direction: null,
        predicted_value: null,
      }),
    ])
    const html = renderToStaticMarkup(
      createElement(ExtraCompare, {
        models: card.models,
        consensus: card.consensus,
        t,
        labels: sideLabelsFor(card.round, t),
      }),
    )
    expect(html).toContain('data-testid="extra-compare"')
    expect(html).toContain(t.extraCompare.title)
    expect(html).toContain(t.extraCompare.crowd(card.consensus.totalModels))
    expect(html).toContain(t.extraCompare.seat.divination)
    expect(html).toContain(t.extraCompare.seat.sentiment)
    expect(html).toContain(t.extraCompare.diverge)
    expect(html).toContain(t.modelList.noResponse)
    expect(html).toContain(t.extraCompare.recordPending)
    expect(html).not.toMatch(/100%/)
    expect(html).not.toContain('data-testid="extra-compare-invented-rate"')
  })

  it('stays hidden when the card has no extra seats', () => {
    const card = buildCardData(round(), [pred({})])
    const html = renderToStaticMarkup(
      createElement(ExtraCompare, { models: card.models, consensus: card.consensus, t }),
    )
    expect(html).toBe('')
  })
})

describe('PredictionAxes display styling', () => {
  it('keeps the same camp/tier counts while using larger colored rows', () => {
    const t = getLeagueUiPack('ko')
    const labels = sideLabelsFor({ proposition_kind: 'binary_close_higher' }, t)
    const html = renderToStaticMarkup(
      createElement(PredictionAxes, {
        campSplit: {
          us: { up: 9, down: 5, flat: 0, abstain: 0 },
          china: { up: 4, down: 2, flat: 0, abstain: 0 },
          other: emptyTally(),
        },
        tierSplit: {
          premier: { up: 6, down: 4, flat: 0, abstain: 0 },
          challenger: emptyTally(),
          world: emptyTally(),
          scout: emptyTally(),
          extra: emptyTally(),
        },
        bookSplit: { closed: { up: 10, down: 6, flat: 0, abstain: 0 }, scout: emptyTally() },
        weightsSplit: { closed: { up: 8, down: 4, flat: 0, abstain: 0 }, open: { up: 2, down: 2, flat: 0, abstain: 0 } },
        t,
        labels,
      }),
    )
    expect(html).toContain(t.verdict.sectionCamp)
    expect(html).toContain(t.verdict.campLabels.us)
    expect(html).toContain(t.predictions.axisPart(9, labels.tallyWord(labels.sides[0])))
    expect(html).toContain(t.predictions.axisPart(5, labels.tallyWord(labels.sides[1])))
    expect(html).toContain('bg-sky-500')
    expect(html).toContain('bg-rose-500')
    expect(html).toContain('text-emerald-600')
    expect(html).toContain('text-rose-600')
    expect(html).not.toMatch(/\d+\/\d+/)
    expect(html).not.toMatch(/[✓✗]/)
  })
})
