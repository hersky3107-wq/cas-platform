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

  it('streaming mounts official tiers plus extra empty, with one skeleton per live seat', () => {
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
    expect(html).toContain('data-tier="extra"')
    expect(html).toContain(t.bracket.division.premier)
    expect(html).toContain(t.bracket.division.challenger)
    expect(html).toContain(t.bracket.division.world)
    expect(html).toContain(t.bracket.division.scout)
    expect(html).toContain(t.bracket.division.extra)
    expect(html).not.toContain(t.modelList.empty)
    expect(html.match(/data-testid="seat-skeleton"/g)?.length).toBe(
      counts.premier + counts.challenger + counts.world + counts.scout + counts.extra
    )
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
      counts.premier + counts.challenger + (counts.world - 1) + counts.scout + counts.extra
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
    expect(html.match(/data-testid="seat-skeleton"/g)?.length).toBe(
      counts.premier + counts.challenger + counts.world + counts.scout + counts.extra - 1
    )
  })

  it('finished cards keep dropped official seats as 미응답 dashed tiles', () => {
    const card = buildCardData(round(), [
      pred({ model_id: 'gpt-5.6-sol', predicted_direction: 'up', league_tier: 'premier' }),
      pred({
        model_id: 'kimi-k3',
        brand: 'Moonshot AI',
        camp: 'china',
        league_tier: 'premier',
        predicted_direction: null,
        predicted_value: null,
      }),
      pred({
        model_id: 'mimo-v2.5',
        brand: 'Xiaomi',
        camp: 'china',
        league_tier: 'world',
        predicted_direction: null,
        predicted_value: null,
      }),
    ])
    const html = renderToStaticMarkup(
      createElement(DivisionBoard, {
        models: card.models,
        tierSplit: card.tierSplit,
        t,
        droppedModelIds: card.droppedModelIds,
      })
    )
    expect(html).not.toContain(t.modelList.empty)
    expect(html).toContain('gpt-5.6-sol')
    expect(html).toContain('Kimi 미응답')
    expect(html).toContain('MiMo 미응답')
    expect(html.match(/data-testid="seat-no-response"/g)?.length).toBe(2)
    expect(html).not.toContain('seat-skeleton')
    expect(html).not.toContain('data-tier')
    expect(html).not.toContain('seat-fail-reason')
  })

  it('admin fail_reason renders next to a 미응답 seat; omitted without the map', () => {
    const tKo = getLeagueUiPack('ko')
    const card = buildCardData(round(), [
      pred({
        model_id: 'kimi-k3',
        brand: 'Moonshot AI',
        camp: 'china',
        league_tier: 'premier',
        predicted_direction: null,
        predicted_value: null,
        fail_reason: 'timeout',
      }),
    ])
    expect(card.droppedFailReasons).toEqual({ 'kimi-k3': 'timeout' })
    const admin = renderToStaticMarkup(
      createElement(DivisionBoard, {
        models: card.models,
        tierSplit: card.tierSplit,
        t: tKo,
        droppedModelIds: card.droppedModelIds,
        droppedFailReasons: card.droppedFailReasons,
      }),
    )
    expect(admin).toContain('Kimi 미응답')
    expect(admin).toContain('timeout')
    const publicHtml = renderToStaticMarkup(
      createElement(DivisionBoard, {
        models: card.models,
        tierSplit: card.tierSplit,
        t: tKo,
        droppedModelIds: card.droppedModelIds,
      }),
    )
    expect(publicHtml).toContain('Kimi 미응답')
    expect(publicHtml).not.toContain('timeout')
    expect(publicHtml).not.toContain('seat-fail-reason')
  })
})

describe('GenerationProgressStrip waiting and completion notes', () => {
  const t = getLeagueUiPack('ko')
  const en = getLeagueUiPack('en')

  it('renders the live arena while generation is in progress (Korean)', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationProgressStrip, {
        queued: false,
        answered: 12,
        rosterSize: 44,
        complete: false,
        t,
        locale: 'ko',
      })
    )
    expect(html).toContain('AI 경기장')
    expect(html).toContain('12/44')
    expect(html).not.toContain('44개 예측 완료')
  })

  it('renders the live arena while generation is in progress (English)', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationProgressStrip, {
        queued: false,
        answered: 20,
        rosterSize: 44,
        complete: false,
        t: en,
        locale: 'en',
      })
    )
    expect(html).toContain('AI arena')
    expect(html).toContain('20/44')
    expect(html).not.toContain('44 predictions ready')
  })

  it('swaps to the completion state when complete is true', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationProgressStrip, {
        queued: false,
        answered: 44,
        rosterSize: 44,
        complete: true,
        t,
      })
    )
    expect(html).toContain('44개 예측 완료')
    expect(html).not.toContain('AI 경기장')
  })
})
