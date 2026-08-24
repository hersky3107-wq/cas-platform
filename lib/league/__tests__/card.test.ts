import { describe, expect, it } from 'vitest'
import { buildCardData } from '../card-aggregate'
import { combinedTrackLine, consensusHeadline, directionBadgeLabel, groupTallyLine } from '../compliance'
import { LEAGUE_UI } from '../i18n/dictionary'
import { MIN_GRADED_ROUNDS_FOR_WIN_RATE } from '../credits'
import type { CardModelPrediction, ConsensusSummary } from '../card-types'

const en = LEAGUE_UI.en

type RoundRow = Parameters<typeof buildCardData>[0]
type PredictionRow = Parameters<typeof buildCardData>[1][number]

function round(overrides: Partial<RoundRow> = {}): RoundRow {
  return {
    id: 'round-1',
    proposition_text: 'Will AAPL close higher 24h from now?',
    category: 'stock',
    color_bucket: 'green',
    instrument: 'AAPL',
    horizon: '1d',
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

describe('buildCardData', () => {
  it('computes consensus tally and majority direction', () => {
    const rows: PredictionRow[] = [
      pred({ model_id: 'a', predicted_direction: 'up', predicted_value: 60 }),
      pred({ model_id: 'b', predicted_direction: 'up', predicted_value: 70 }),
      pred({ model_id: 'c', predicted_direction: 'down', predicted_value: 55 }),
      pred({ model_id: 'd', predicted_direction: null, predicted_value: null }),
    ]
    const card = buildCardData(round(), rows)
    expect(card.consensus.tally).toEqual({ up: 2, down: 1, flat: 0, abstain: 1 })
    expect(card.consensus.majorityDirection).toBe('up')
    expect(card.consensus.totalModels).toBe(4)
    expect(card.consensus.respondedModels).toBe(3)
    // avg of the two 'up' + one 'down' directional responses: (60+70+55)/3
    expect(card.consensus.avgProbability).toBeCloseTo(61.7, 1)
    expect(card.combinedTrack.n).toBe(0)
    expect(card.combinedTrack.winRatePct).toBeNull()
    expect(card.combinedTrack.provisional).toBe(true)
  })

  it('reports no majority on a tie', () => {
    const rows: PredictionRow[] = [
      pred({ model_id: 'a', predicted_direction: 'up' }),
      pred({ model_id: 'b', predicted_direction: 'down' }),
    ]
    const card = buildCardData(round(), rows)
    expect(card.consensus.majorityDirection).toBeNull()
  })

  it('reports null majority and null avgProbability when every model abstains', () => {
    const rows: PredictionRow[] = [
      pred({ model_id: 'a', predicted_direction: null, predicted_value: null }),
      pred({ model_id: 'b', predicted_direction: null, predicted_value: null }),
    ]
    const card = buildCardData(round(), rows)
    expect(card.consensus.majorityDirection).toBeNull()
    expect(card.consensus.avgProbability).toBeNull()
    expect(card.consensus.respondedModels).toBe(0)
  })

  it('splits direction tallies per camp (us/china/other)', () => {
    const rows: PredictionRow[] = [
      pred({ model_id: 'a', camp: 'us', predicted_direction: 'up' }),
      pred({ model_id: 'b', camp: 'us', predicted_direction: 'up' }),
      pred({ model_id: 'c', camp: 'china', predicted_direction: 'down' }),
      pred({ model_id: 'd', camp: 'other', predicted_direction: null, predicted_value: null }),
    ]
    const card = buildCardData(round(), rows)
    expect(card.campSplit.us).toEqual({ up: 2, down: 0, flat: 0, abstain: 0 })
    expect(card.campSplit.china).toEqual({ up: 0, down: 1, flat: 0, abstain: 0 })
    expect(card.campSplit.other).toEqual({ up: 0, down: 0, flat: 0, abstain: 1 })
  })

  it('splits direction tallies per league tier', () => {
    const rows: PredictionRow[] = [
      pred({ model_id: 'a', league_tier: 'premier', predicted_direction: 'up' }),
      pred({ model_id: 'b', league_tier: 'world', predicted_direction: 'flat' }),
      pred({ model_id: 'c', league_tier: 'scout', predicted_direction: 'down', predicted_value: 62 }),
    ]
    const card = buildCardData(round(), rows)
    expect(card.tierSplit.premier).toEqual({ up: 1, down: 0, flat: 0, abstain: 0 })
    expect(card.tierSplit.world).toEqual({ up: 0, down: 0, flat: 1, abstain: 0 })
    expect(card.tierSplit.scout).toEqual({ up: 0, down: 1, flat: 0, abstain: 0 })
    expect(card.tierSplit.challenger).toEqual({ up: 0, down: 0, flat: 0, abstain: 0 })
  })

  it('hit rate stays null/unresolved until models are graded', () => {
    const rows: PredictionRow[] = [pred({ model_id: 'a', is_correct: null })]
    const card = buildCardData(round(), rows)
    expect(card.hitRate).toEqual({ resolved: false, graded: 0, correct: null, hitRatePct: null, provisional: true })
  })

  it('keeps the raw record but NO percentage while fewer models than the minimum sample are graded', () => {
    const rows: PredictionRow[] = [
      pred({ model_id: 'a', is_correct: true }),
      pred({ model_id: 'b', is_correct: true }),
      pred({ model_id: 'c', is_correct: false }),
      pred({ model_id: 'd', is_correct: null }),
    ]
    const card = buildCardData(round({ resolved_at: '2026-08-17T15:35:00.000Z' }), rows)
    expect(card.hitRate.resolved).toBe(true)
    expect(card.hitRate.graded).toBe(3)
    expect(card.hitRate.correct).toBe(2)
    // 3 graded models is below the minimum sample: the badge shows "2W 1L", not "66.6%".
    expect(card.hitRate.hitRatePct).toBeNull()
    expect(card.hitRate.provisional).toBe(true)
  })

  it('computes a truncated hit rate once the minimum sample is graded', () => {
    const rows: PredictionRow[] = Array.from({ length: MIN_GRADED_ROUNDS_FOR_WIN_RATE }, (_, i) =>
      pred({ model_id: `m${i}`, is_correct: i < 8 })
    )
    const card = buildCardData(round({ resolved_at: '2026-08-17T15:35:00.000Z' }), rows)
    expect(card.hitRate.graded).toBe(MIN_GRADED_ROUNDS_FOR_WIN_RATE)
    expect(card.hitRate.hitRatePct).toBe(80)
    expect(card.hitRate.provisional).toBe(false)
  })

  it('falls back an unrecognized color_bucket to yellow rather than throwing', () => {
    const card = buildCardData(round({ color_bucket: 'not-a-real-bucket' }), [])
    expect(card.round.color_bucket).toBe('yellow')
  })

  it('preserves per-model fields verbatim, including cost_usd and reasoning_snippet', () => {
    const rows: PredictionRow[] = [
      pred({ model_id: 'gpt-4o', brand: 'OpenAI', cost_usd: 0.0123, reasoning_snippet: 'Strong earnings.' }),
    ]
    const card = buildCardData(round(), rows)
    expect(card.models[0]).toMatchObject({
      model_id: 'gpt-4o',
      brand: 'OpenAI',
      cost_usd: 0.0123,
      reasoning_snippet: 'Strong earnings.',
    })
  })

  it('presents a due round with no anchor as unresolvable, never as grading', () => {
    const card = buildCardData(
      round({
        resolves_at: '2026-08-19T03:12:40.000Z',
        actual_outcome: null,
        resolved_at: null,
        anchor_price: null,
        anchor_price_at: null,
      }),
      []
    )
    expect(card.round.gradingState).toBe('unresolvable')
    expect(card.round.unresolvableReason).toBe('missing_anchor')
    expect(card.round.gradingState).not.toBe('grading')
  })
})

describe('compliance: approved phrasing helpers', () => {
  const baseConsensus: ConsensusSummary = {
    tally: { up: 6, down: 1, flat: 1, abstain: 0 },
    majorityDirection: 'up',
    totalModels: 8,
    respondedModels: 8,
    avgProbability: 58.4,
  }

  it('renders the approved "N of M AI models lean X" headline with confidence', () => {
    expect(consensusHeadline(baseConsensus, en)).toBe('6 of 8 AI models lean UP · 58% avg confidence')
  })

  it('never emits an imperative like "buy" or "sell" for any direction', () => {
    for (const direction of ['up', 'down', 'flat'] as const) {
      const headline = consensusHeadline({ ...baseConsensus, majorityDirection: direction }, en)
      expect(headline.toLowerCase()).not.toMatch(/\b(buy|sell|bet)\b/)
    }
  })

  it('describes an all-abstain round without a majority claim', () => {
    const headline = consensusHeadline(
      {
        tally: { up: 0, down: 0, flat: 0, abstain: 5 },
        majorityDirection: null,
        totalModels: 5,
        respondedModels: 0,
        avgProbability: null,
      },
      en
    )
    expect(headline).toBe('All 5 AI models abstained on this round')
  })

  it('describes a tie as split, not a false majority', () => {
    const headline = consensusHeadline(
      {
        tally: { up: 2, down: 2, flat: 0, abstain: 0 },
        majorityDirection: null,
        totalModels: 4,
        respondedModels: 4,
        avgProbability: 50,
      },
      en
    )
    expect(headline).toBe('4 of 4 AI models are split — no clear lean')
  })

  it('badges a null direction as NO CALL, never blank or an instruction', () => {
    expect(directionBadgeLabel(null, en)).toBe('NO CALL')
    expect(directionBadgeLabel('up', en)).toBe('UP')
    expect(directionBadgeLabel('down', en)).toBe('DOWN')
    expect(directionBadgeLabel('flat', en)).toBe('FLAT')
  })

  it('formats a group tally line for camp/tier summaries', () => {
    const tally = { up: 3, down: 1, flat: 0, abstain: 1 }
    expect(groupTallyLine('US', tally, en)).toBe('US: 3 up · 1 down · 1 no call')
  })

  it('cites the combined method track record without advice language', () => {
    const line = combinedTrackLine({ correct: 7, resolved: 12, n: 12, winRatePct: 58.3, provisional: false }, en)
    expect(line).toContain('58.3')
    expect(line).toContain('12')
    expect(line.toLowerCase()).not.toMatch(/\b(buy|sell|bet)\b/)
    expect(combinedTrackLine({ correct: 0, resolved: 0, n: 0, winRatePct: null, provisional: true }, en)).toBe(
      en.bracket.combinedTrackPending
    )
  })

  it('states the raw record instead of a percentage while the combined method is below the minimum sample', () => {
    const line = combinedTrackLine({ correct: 1, resolved: 1, n: 1, winRatePct: null, provisional: true }, en)
    expect(line).not.toContain('%')
    expect(line).not.toContain('100')
    expect(line).toContain('1W 0L')
    expect(line).toContain(en.bracket.combinedTrackPending)
  })

  it('states that a round-level tally is one correlated event, not independent forecasts', () => {
    expect(en.headline.correlatedNote.toLowerCase()).toMatch(/correlated/)
    expect(en.headline.correlatedNote.toLowerCase()).toMatch(/not 40 independent/)
    expect(en.headline.correlatedNote.toLowerCase()).not.toMatch(/\b(buy|sell|bet)\b/)
  })

  it('produces a translated headline for a non-English locale without changing the underlying data', () => {
    const ko = LEAGUE_UI.ko
    const headline = consensusHeadline(baseConsensus, ko)
    expect(headline).toContain('8')
    expect(headline).toContain('6')
    expect(headline).not.toBe(consensusHeadline(baseConsensus, en))
  })
})

describe('card-types groupings stay in sync with model rows (sanity)', () => {
  it('every model produced by buildCardData has a camp/tier the split tables recognize', () => {
    const rows: PredictionRow[] = [pred({ model_id: 'a' })]
    const card = buildCardData(round(), rows)
    const model: CardModelPrediction = card.models[0]!
    expect(card.campSplit[model.camp]).toBeDefined()
    expect(card.tierSplit[model.league_tier]).toBeDefined()
  })

  it('enriches tile brand and model identifier from roster config', () => {
    const rows: PredictionRow[] = [pred({ model_id: 'gpt-5.6-luna', brand: 'OpenAI' })]
    const card = buildCardData(round(), rows)
    expect(card.models[0]!.brand).toBe('OpenAI (ChatGPT)')
    expect(card.models[0]!.model_identifier).toBe('gpt-5.6-luna')
  })
})
