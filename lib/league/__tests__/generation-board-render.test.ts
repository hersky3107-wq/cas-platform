import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DivisionBoard } from '../../../components/league/DivisionBoard'
import { GenerationProgressStrip } from '../../../components/league/GenerationProgressStrip'
import { buildCardData, type PredictionRow, type RoundRow } from '../card-aggregate'
import { rosterSeatCounts } from '../generation-board'
import { getLeagueUiPack } from '../i18n/dictionary'
import { getRoster } from '../roster'
import type { CardModelPrediction } from '../card-types'

function round(): RoundRow {
  return {
    id: 'round-stream',
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
    model_id: 'gpt-4o',
    brand: 'OpenAI',
    camp: 'us',
    league_tier: 'premier',
    predicted_direction: 'up',
    predicted_value: 60,
    reasoning_snippet: 'Momentum looks positive.',
    is_correct: null,
    cost_usd: 0.01,
    predicted_at: '2026-08-16T21:31:00.000Z',
    ...overrides,
  }
}

function tile(overrides: Partial<CardModelPrediction> = {}): CardModelPrediction {
  return {
    prediction_id: null,
    model_id: 'world-one',
    brand: 'Qwen',
    model_identifier: 'world-one',
    camp: 'china',
    league_tier: 'world',
    direction: 'up',
    probability: 61,
    magnitude: null,
    qualifierText: null,
    reasoning_snippet: 'bid',
    is_correct: null,
    cost_usd: 0.01,
    predicted_at: '2026-08-16T21:31:05.000Z',
    ...overrides,
  }
}

describe('DivisionBoard live streaming shells', () => {
  const t = getLeagueUiPack('ko')
  const counts = rosterSeatCounts()

  it('static empty board is unchanged — no four-tier shells', () => {
    const card = buildCardData(round(), [])
    const html = renderToStaticMarkup(
      createElement(DivisionBoard, { models: card.models, tierSplit: card.tierSplit, t })
    )
    expect(html).toContain(t.modelList.empty)
    expect(html).not.toContain('data-tier')
    expect(html).not.toContain('seat-skeleton')
  })

  it('streaming mounts all four tiers empty, with one skeleton per live seat', () => {
    const card = buildCardData(round(), [])
    const html = renderToStaticMarkup(
      createElement(DivisionBoard, {
        models: [],
        tierSplit: card.tierSplit,
        t,
        streaming: true,
      })
    )
    expect(html).toContain('data-tier="premier"')
    expect(html).toContain('data-tier="challenger"')
    expect(html).toContain('data-tier="world"')
    expect(html).toContain('data-tier="scout"')
    expect(html).toContain(t.bracket.division.premier)
    expect(html).toContain(t.bracket.division.challenger)
    expect(html).toContain(t.bracket.division.world)
    expect(html).toContain(t.bracket.division.scout)
    expect(html).not.toContain(t.modelList.empty)
    expect(html.match(/data-testid="seat-skeleton"/g)?.length).toBe(getRoster().length)
  })

  it('a world tile fills world immediately — premier/challenger/scout stay mounted with their own skeletons', () => {
    const card = buildCardData(round(), [])
    const html = renderToStaticMarkup(
      createElement(DivisionBoard, {
        models: [tile()],
        tierSplit: card.tierSplit,
        t,
        streaming: true,
      })
    )
    expect(html).toContain('world-one')
    expect(html).toContain('data-tier="premier"')
    expect(html).toContain('data-tier="challenger"')
    expect(html).toContain('data-tier="scout"')
    expect(html.match(/data-testid="seat-skeleton"/g)?.length).toBe(
      counts.premier + counts.challenger + (counts.world - 1) + counts.scout
    )
  })

  it('a dropped premier seat becomes 미응답, not a missing skeleton that stalls the board', () => {
    const card = buildCardData(round(), [])
    const dropped = getRoster(['premier'])[0]!.model_id
    const html = renderToStaticMarkup(
      createElement(DivisionBoard, {
        models: [],
        tierSplit: card.tierSplit,
        t,
        streaming: true,
        droppedModelIds: [dropped],
      })
    )
    expect(html).toContain(t.modelList.noResponse)
    expect(html.match(/data-testid="seat-no-response"/g)?.length).toBe(1)
    expect(html.match(/data-testid="seat-skeleton"/g)?.length).toBe(getRoster().length - 1)
  })
})

describe('GenerationProgressStrip waiting and completion notes', () => {
  const t = getLeagueUiPack('ko')
  const en = getLeagueUiPack('en')

  it('renders the subtle waiting note while generation is in progress (Korean)', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationProgressStrip, {
        queued: false,
        answered: 12,
        rosterSize: 41,
        complete: false,
        t,
      })
    )
    expect(html).toContain('AI들이 예측 중입니다 · 잠시만 기다려 주세요')
    expect(html).toContain('12/41')
    expect(html).not.toContain('41개 예측 완료')
  })

  it('renders the subtle waiting note while generation is in progress (English)', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationProgressStrip, {
        queued: false,
        answered: 20,
        rosterSize: 41,
        complete: false,
        t: en,
      })
    )
    expect(html).toContain('AIs are formulating predictions · Please wait a moment')
    expect(html).toContain('20/41')
    expect(html).not.toContain('41 predictions ready')
  })

  it('swaps to the completion state when complete is true', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationProgressStrip, {
        queued: false,
        answered: 41,
        rosterSize: 41,
        complete: true,
        t,
      })
    )
    expect(html).toContain('41개 예측 완료')
    expect(html).not.toContain('AI들이 예측 중입니다 · 잠시만 기다려 주세요')
  })
})
