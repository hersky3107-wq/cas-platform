import { describe, expect, it } from 'vitest'
import { binaryCallsFromModels, dualConsensus } from '../log-odds-consensus'
import {
  brandTableFirstPick,
  computeConsensusSnapshot,
  consensusIsCorrect,
  firstOutcomeToken,
  persistFieldsFromSnapshot,
} from '../consensus-snapshot'

describe('computeConsensusSnapshot — binary', () => {
  const rows = [
    { direction: 'up', probability: 70, magnitude: 1, league_tier: 'premier' },
    { direction: 'up', probability: 60, magnitude: 2, league_tier: 'premier' },
    { direction: 'down', probability: 55, magnitude: -1, league_tier: 'challenger' },
    { direction: 'down', probability: 90, magnitude: -3, league_tier: 'extra', model_id: 'crow' },
  ]

  it('matches live dualConsensus on official rows and drops extra seats', () => {
    const live = dualConsensus(
      binaryCallsFromModels(
        rows.filter((r) => r.league_tier !== 'extra').map((r) => ({ direction: r.direction, probability: r.probability })),
      ),
    )
    const snap = computeConsensusSnapshot({ rows, mode: 'binary' })
    expect(snap.aggregateDirection).toBe(live.aggregate.direction)
    expect(snap.aggregateProbability).toBe(live.aggregate.probability)
    expect(snap.majorityDirection).toBe(live.majority.direction)
    expect(snap.aggregateDirection).toBe('up')
  })

  it('persist payload always includes both aggregate fields', () => {
    const fields = persistFieldsFromSnapshot(computeConsensusSnapshot({ rows, mode: 'binary' }))
    expect(fields).toMatchObject({
      consensus_aggregate_direction: 'up',
    })
    expect(fields.consensus_aggregate_probability).toEqual(expect.any(Number))
    expect('consensus_aggregate_direction' in fields).toBe(true)
    expect('consensus_aggregate_probability' in fields).toBe(true)
  })
})

describe('computeConsensusSnapshot — brand_table', () => {
  it('stores the official #1 brand as the aggregate pick and ignores extra seats', () => {
    const snap = computeConsensusSnapshot({
      mode: 'brand_table',
      rows: [
        { direction: null, probability: 70, qualifierText: 'OpenAI|Google|Anthropic', league_tier: 'premier' },
        { direction: null, probability: 80, qualifierText: 'OpenAI|Anthropic|Google', league_tier: 'premier' },
        { direction: null, probability: 60, qualifierText: 'Google|OpenAI|Anthropic', league_tier: 'challenger' },
        { direction: null, probability: 99, qualifierText: 'xAI|OpenAI|Google', league_tier: 'extra', model_id: 'crow' },
      ],
    })
    expect(snap.majorityDirection).toBe('OpenAI')
    expect(snap.aggregateDirection).toBe('OpenAI')
    expect(snap.aggregateProbability).toEqual(expect.any(Number))
  })
})

describe('consensusIsCorrect', () => {
  it('parses the leading side token from the audit string', () => {
    expect(firstOutcomeToken('up (2026-08-18 close 310 vs anchor 305)')).toBe('up')
    expect(
      consensusIsCorrect({
        aggregateDirection: 'up',
        actualOutcome: 'up (2026-08-18 close 310 vs anchor 305)',
        mode: 'binary',
      }),
    ).toBe(true)
    expect(
      consensusIsCorrect({
        aggregateDirection: 'up',
        actualOutcome: 'down (2026-09-24 close 63 vs anchor 66)',
        mode: 'binary',
      }),
    ).toBe(false)
  })

  it('compares brand_table #1 brands', () => {
    expect(brandTableFirstPick('OpenAI|Google|Anthropic')).toBe('OpenAI')
    expect(
      consensusIsCorrect({
        aggregateDirection: 'OpenAI',
        actualOutcome: 'table:OpenAI|Google|Anthropic @ 2026-10-01',
        mode: 'brand_table',
      }),
    ).toBe(true)
    expect(
      consensusIsCorrect({
        aggregateDirection: 'OpenAI',
        actualOutcome: 'table:Google|OpenAI|Anthropic @ 2026-10-01',
        mode: 'brand_table',
      }),
    ).toBe(false)
  })

  it('is null when ungraded or missing a pick', () => {
    expect(consensusIsCorrect({ aggregateDirection: null, actualOutcome: 'up (x)', mode: 'binary' })).toBeNull()
    expect(consensusIsCorrect({ aggregateDirection: 'up', actualOutcome: null, mode: 'binary' })).toBeNull()
  })
})
