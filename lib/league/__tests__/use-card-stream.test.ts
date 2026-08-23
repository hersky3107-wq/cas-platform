import { describe, expect, it } from 'vitest'
import { buildCardData } from '../card-aggregate'
import { mergeModel, resort } from '../use-card-stream'
import type { CardData, CardModelPrediction } from '../card-types'

type RoundRow = Parameters<typeof buildCardData>[0]
type PredictionRow = Parameters<typeof buildCardData>[1][number]

function round(overrides: Partial<RoundRow> = {}): RoundRow {
  return {
    id: 'round-1',
    proposition_text: 'Will AAPL close higher 24h from now?',
    category: 'stock',
    color_bucket: 'green',
    instrument: 'AAPL',
    horizon: '24h',
    resolution_rule: 'NASDAQ regular-session close price vs prior close',
    resolves_at: '2026-08-17T15:31:00.000Z',
    opened_at: '2026-08-16T21:30:00.000Z',
    actual_outcome: null,
    resolved_at: null,
    ...overrides,
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

function liveModel(overrides: Partial<CardModelPrediction> = {}): CardModelPrediction {
  return {
    prediction_id: null,
    model_id: 'gpt-4o',
    brand: 'OpenAI',
    model_identifier: 'gpt-4o',
    camp: 'us',
    league_tier: 'premier',
    direction: 'up',
    probability: 60,
    reasoning_snippet: 'Momentum looks positive.',
    is_correct: null,
    cost_usd: 0.01,
    predicted_at: '2026-08-16T21:31:05.000Z',
    ...overrides,
  }
}

function emptyCard(): CardData {
  return buildCardData(round(), [])
}

describe('use-card-stream: live merge (Layer 4)', () => {
  it('adds a model that arrives on an empty card', () => {
    const start = emptyCard()
    const next = mergeModel(start, liveModel())
    expect(next.models).toHaveLength(1)
    expect(next.models[0]!.model_id).toBe('gpt-4o')
    expect(next.consensus.totalModels).toBe(1)
    expect(next.consensus.tally.up).toBe(1)
  })

  it('merges by model_id — a re-delivered model REPLACES, never duplicates', () => {
    const start = emptyCard()
    const first = mergeModel(start, liveModel({ direction: 'up', probability: 55 }))
    // Simulates the stream re-sending the same model (or a concurrent
    // refetch already having added it) with an updated value.
    const second = mergeModel(first, liveModel({ direction: 'down', probability: 80 }))

    expect(second.models).toHaveLength(1)
    expect(second.models[0]!.direction).toBe('down')
    expect(second.models[0]!.probability).toBe(80)
    // Aggregates reflect the REPLACED value, not both.
    expect(second.consensus.tally.up).toBe(0)
    expect(second.consensus.tally.down).toBe(1)
  })

  it('accumulates multiple distinct models in arrival order without dropping any', () => {
    let card = emptyCard()
    card = mergeModel(card, liveModel({ model_id: 'gpt-4o', league_tier: 'premier', camp: 'us' }))
    card = mergeModel(
      card,
      liveModel({ model_id: 'qwen/qwen3.8-max', brand: 'Qwen', league_tier: 'premier', camp: 'china', direction: 'down' })
    )
    card = mergeModel(
      card,
      liveModel({ model_id: 'sonar', brand: 'Perplexity', league_tier: 'scout', camp: 'us', direction: 'up', probability: 55 })
    )

    expect(card.models.map((m) => m.model_id)).toEqual(['gpt-4o', 'qwen/qwen3.8-max', 'sonar'])
    expect(card.consensus.totalModels).toBe(3)
    expect(card.consensus.respondedModels).toBe(3)
  })

  it('re-sorts by tier then camp on "done", independent of arrival order', () => {
    let card = emptyCard()
    // Arrive out of tier/camp order: scout, then premier/china, then premier/us.
    card = mergeModel(card, liveModel({ model_id: 'sonar', league_tier: 'scout', camp: 'us' }))
    card = mergeModel(card, liveModel({ model_id: 'qwen/qwen3.8-max', league_tier: 'premier', camp: 'china' }))
    card = mergeModel(card, liveModel({ model_id: 'gpt-4o', league_tier: 'premier', camp: 'us' }))

    expect(card.models.map((m) => m.model_id)).toEqual(['sonar', 'qwen/qwen3.8-max', 'gpt-4o'])

    const sorted = resort(card)
    expect(sorted.models.map((m) => m.model_id)).toEqual(['gpt-4o', 'qwen/qwen3.8-max', 'sonar'])
    // Resorting is a pure reordering — same models, same aggregates.
    expect(sorted.consensus.totalModels).toBe(3)
  })

  it('converges to the same aggregates as a DB-assembled card once all rows are present, regardless of arrival order', () => {
    const rows: PredictionRow[] = [
      pred({ model_id: 'gpt-4o', predicted_direction: 'up', predicted_value: 60 }),
      pred({ model_id: 'claude-sonnet-4-6', brand: 'Anthropic', predicted_direction: 'up', predicted_value: 70 }),
      pred({ model_id: 'deepseek-chat', brand: 'DeepSeek', camp: 'china', league_tier: 'challenger', predicted_direction: 'down', predicted_value: 55 }),
    ]
    const authoritative = buildCardData(round(), rows)

    // Simulate the live stream delivering the same three rows in a different order.
    let live = emptyCard()
    for (const row of [rows[2]!, rows[0]!, rows[1]!]) {
      live = mergeModel(live, {
        prediction_id: row.id ?? null,
        model_id: row.model_id,
        brand: row.brand,
        model_identifier: row.model_id,
        camp: row.camp as CardModelPrediction['camp'],
        league_tier: row.league_tier as CardModelPrediction['league_tier'],
        direction: row.predicted_direction as CardModelPrediction['direction'],
        probability: row.predicted_value,
        reasoning_snippet: row.reasoning_snippet,
        is_correct: null,
        cost_usd: row.cost_usd,
        predicted_at: row.predicted_at,
      })
    }
    live = resort(live)

    expect(live.consensus).toEqual(authoritative.consensus)
    expect(live.campSplit).toEqual(authoritative.campSplit)
    expect(live.tierSplit).toEqual(authoritative.tierSplit)
    expect(live.models.map((m) => m.model_id)).toEqual(authoritative.models.map((m) => m.model_id))
  })

  it('a GET-refetch reconcile after live arrival is idempotent (merging the DB copy of an already-seen model is a no-op)', () => {
    let card = emptyCard()
    const arrived = liveModel({ model_id: 'gpt-4o', direction: 'up', probability: 60 })
    card = mergeModel(card, arrived)

    // "Reconnect": the exact same row comes back from GET /api/league/card.
    const fromDb: CardModelPrediction = { ...arrived }
    const reconciled = mergeModel(card, fromDb)

    expect(reconciled.models).toHaveLength(1)
    expect(reconciled).toEqual(card)
  })
})
