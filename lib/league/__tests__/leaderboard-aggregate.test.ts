import { describe, expect, it } from 'vitest'
import {
  LEADERBOARD_MIN_SAMPLE,
  buildCombinedMethodTrack,
  buildLeaderboardData,
  buildLeaderboardSlice,
  type GradedPredictionRow,
} from '../leaderboard-aggregate'

function row(overrides: Partial<GradedPredictionRow> = {}): GradedPredictionRow {
  return {
    model_id: 'gpt-4o',
    brand: 'OpenAI',
    camp: 'us',
    league_tier: 'premier',
    category: 'stock',
    is_correct: true,
    round_id: 'r1',
    predicted_direction: 'up',
    ...overrides,
  }
}

/** `count` graded rows for one bucket, the first `correct` of them right. */
function rowsFor(modelId: string, count: number, correct: number, overrides: Partial<GradedPredictionRow> = {}) {
  return Array.from({ length: count }, (_, i) =>
    row({ model_id: modelId, round_id: `${modelId}-${i}`, is_correct: i < correct, ...overrides })
  )
}

describe('buildLeaderboardSlice', () => {
  it('groups per-model correct/resolved/n', () => {
    const rows = [
      row({ model_id: 'a', brand: 'A', is_correct: true }),
      row({ model_id: 'a', brand: 'A', is_correct: true }),
      row({ model_id: 'a', brand: 'A', is_correct: false }),
      row({ model_id: 'b', brand: 'B', is_correct: false }),
    ]
    const slice = buildLeaderboardSlice(rows, 'model')
    expect(slice.totalResolved).toBe(4)
    const a = slice.rows.find((r) => r.key === 'a')!
    expect(a.correct).toBe(2)
    expect(a.resolved).toBe(3)
    expect(a.n).toBe(3)
    const b = slice.rows.find((r) => r.key === 'b')!
    expect(b.correct).toBe(0)
    expect(b.resolved).toBe(1)
  })

  it('publishes NO percentage and NO rank below the minimum sample', () => {
    const slice = buildLeaderboardSlice(rowsFor('one-round-perfect', 1, 1), 'model')
    const only = slice.rows[0]!
    // The 100%-off-one-round case this guard exists for: the number must not
    // exist in the payload at all, so no client can render it.
    expect(only.winRatePct).toBeNull()
    expect(only.rank).toBeNull()
    expect(only.provisional).toBe(true)
    expect(only.correct).toBe(1)
    expect(only.resolved).toBe(1)
    expect(slice.rankedRows).toBe(0)
  })

  it('publishes a TRUNCATED percentage and a rank at the minimum sample', () => {
    const slice = buildLeaderboardSlice(rowsFor('at', LEADERBOARD_MIN_SAMPLE, LEADERBOARD_MIN_SAMPLE - 1), 'model')
    const at = slice.rows[0]!
    expect(at.n).toBe(LEADERBOARD_MIN_SAMPLE)
    expect(at.provisional).toBe(false)
    expect(at.rank).toBe(1)
    expect(at.winRatePct).toBe(90)
    expect(slice.rankedRows).toBe(1)
  })

  it('truncates rather than rounds up — 2/3 of a qualifying sample never becomes the higher figure', () => {
    // 8/12 = 66.66…: must publish 66.6, not 66.7.
    const slice = buildLeaderboardSlice(rowsFor('two-thirds', 12, 8), 'model')
    expect(slice.rows[0]!.winRatePct).toBe(66.6)
  })

  it('ranks only qualifying rows, and never lets a low-sample row outrank them', () => {
    const rows = [
      ...rowsFor('low-n-perfect', 1, 1),
      ...rowsFor('high-n-good', LEADERBOARD_MIN_SAMPLE + 2, LEADERBOARD_MIN_SAMPLE),
    ]
    const slice = buildLeaderboardSlice(rows, 'model')
    expect(slice.rows[0]!.key).toBe('high-n-good')
    expect(slice.rows[0]!.rank).toBe(1)
    const low = slice.rows.find((r) => r.key === 'low-n-perfect')!
    expect(low.rank).toBeNull()
    expect(low.winRatePct).toBeNull()
    expect(slice.rankedRows).toBe(1)
  })

  it('orders unranked rows by roster position, not by their (hidden) win rate', () => {
    // Two low-sample rows: the perfect one must not float to the top of the
    // unranked block, or its position becomes the ranking claim all over again.
    const rows = [...rowsFor('gpt-5.6-sol', 2, 0), ...rowsFor('claude-fable-5', 2, 2)]
    const slice = buildLeaderboardSlice(rows, 'model')
    expect(slice.rows.every((r) => r.rank === null && r.winRatePct === null)).toBe(true)
    const perfect = slice.rows.findIndex((r) => r.key === 'claude-fable-5')
    const zero = slice.rows.findIndex((r) => r.key === 'gpt-5.6-sol')
    // Roster order (gpt-5.6-sol is listed first), i.e. unrelated to performance.
    expect(zero).toBeLessThan(perfect)
  })

  it('applies the same rule to non-model aggregates (camp / tier / brand)', () => {
    const rows = [
      ...rowsFor('us-model', 3, 3, { camp: 'us', league_tier: 'premier', brand: 'OpenAI' }),
      ...rowsFor('cn-model', LEADERBOARD_MIN_SAMPLE, 5, { camp: 'china', league_tier: 'world', brand: 'DeepSeek' }),
    ]
    for (const scope of ['camp', 'campHeadline', 'tier', 'brand', 'category'] as const) {
      const slice = buildLeaderboardSlice(rows, scope)
      for (const bucket of slice.rows) {
        if (bucket.n < LEADERBOARD_MIN_SAMPLE) {
          expect(bucket.winRatePct).toBeNull()
          expect(bucket.rank).toBeNull()
        } else {
          expect(bucket.winRatePct).not.toBeNull()
          expect(bucket.rank).not.toBeNull()
        }
      }
    }
  })

  it('includes scout in the tier slice (directional rankings)', () => {
    const rows = [row({ league_tier: 'premier' }), row({ league_tier: 'scout', model_id: 'sonar' })]
    const slice = buildLeaderboardSlice(rows, 'tier')
    expect(slice.rows.some((r) => r.key === 'scout')).toBe(true)
    expect(slice.rows.some((r) => r.key === 'premier')).toBe(true)
  })

  it('campHeadline is US vs China only — third-country is omitted', () => {
    const rows = [
      row({ camp: 'us' }),
      row({ camp: 'china', is_correct: false }),
      row({ camp: 'other', brand: 'Mistral', model_id: 'mistral' }),
    ]
    const slice = buildLeaderboardSlice(rows, 'campHeadline')
    expect(slice.rows.map((r) => r.key).sort()).toEqual(['china', 'us'])
  })

  it('camp 3-way includes third-country', () => {
    const rows = [row({ camp: 'us' }), row({ camp: 'other', brand: 'Upstage', model_id: 'solar' })]
    const slice = buildLeaderboardSlice(rows, 'camp')
    expect(slice.rows.some((r) => r.key === 'other')).toBe(true)
  })

  it('method slice splits pure-reasoning (1/2/3) vs research (scout)', () => {
    const rows = [
      row({ league_tier: 'premier', is_correct: true }),
      row({ league_tier: 'world', is_correct: false, model_id: 'luna' }),
      row({ league_tier: 'scout', is_correct: true, model_id: 'sonar' }),
    ]
    const slice = buildLeaderboardSlice(rows, 'method')
    const reasoning = slice.rows.find((r) => r.key === 'pure_reasoning')!
    const research = slice.rows.find((r) => r.key === 'research')!
    expect(reasoning.n).toBe(2)
    expect(reasoning.correct).toBe(1)
    expect(research.n).toBe(1)
    expect(research.correct).toBe(1)
  })

  it('brand slice groups a company\'s models together', () => {
    const rows = [
      row({ model_id: 'gpt-a', brand: 'OpenAI' }),
      row({ model_id: 'gpt-b', brand: 'OpenAI', is_correct: false }),
      row({ model_id: 'gem', brand: 'Google' }),
    ]
    const slice = buildLeaderboardSlice(rows, 'brand')
    expect(slice.rows.find((r) => r.key === 'OpenAI')!.n).toBe(2)
    expect(slice.rows.find((r) => r.key === 'Google')!.n).toBe(1)
  })

  it('korea slice only includes Upstage / NAVER / LG', () => {
    const rows = [
      row({ brand: 'Upstage', model_id: 'solar' }),
      row({ brand: 'NAVER', model_id: 'hcx', is_correct: false }),
      row({ brand: 'LG', model_id: 'exaone' }),
      row({ brand: 'OpenAI', model_id: 'gpt' }),
    ]
    const slice = buildLeaderboardSlice(rows, 'korea')
    expect(slice.rows.map((r) => r.key).sort()).toEqual(['LG', 'NAVER', 'Upstage'])
  })

  it('a slice with zero rows has no entries and no NaN', () => {
    const slice = buildLeaderboardSlice([], 'model')
    expect(slice.rows).toEqual([])
    expect(slice.totalResolved).toBe(0)
  })
})

describe('buildCombinedMethodTrack', () => {
  it('counts a round as correct when the majority direction was right, but publishes no rate off one round', () => {
    const rows = [
      row({ round_id: 'r1', predicted_direction: 'up', is_correct: true, model_id: 'a' }),
      row({ round_id: 'r1', predicted_direction: 'up', is_correct: true, model_id: 'b' }),
      row({ round_id: 'r1', predicted_direction: 'down', is_correct: false, model_id: 'c' }),
    ]
    const track = buildCombinedMethodTrack(rows)
    expect(track.n).toBe(1)
    expect(track.correct).toBe(1)
    expect(track.winRatePct).toBeNull()
    expect(track.provisional).toBe(true)
  })

  it('publishes a truncated rate once the combined method reaches the minimum sample', () => {
    const rows = Array.from({ length: LEADERBOARD_MIN_SAMPLE }, (_, i) => [
      row({ round_id: `r${i}`, predicted_direction: 'up', is_correct: i < 6, model_id: 'a' }),
      row({ round_id: `r${i}`, predicted_direction: 'up', is_correct: i < 6, model_id: 'b' }),
      row({ round_id: `r${i}`, predicted_direction: 'down', is_correct: i >= 6, model_id: 'c' }),
    ]).flat()
    const track = buildCombinedMethodTrack(rows)
    expect(track.n).toBe(LEADERBOARD_MIN_SAMPLE)
    expect(track.correct).toBe(6)
    expect(track.winRatePct).toBe(60)
    expect(track.provisional).toBe(false)
  })

  it('skips a tied majority so n is honest', () => {
    const rows = [
      row({ round_id: 'r1', predicted_direction: 'up', is_correct: true, model_id: 'a' }),
      row({ round_id: 'r1', predicted_direction: 'down', is_correct: false, model_id: 'b' }),
    ]
    const track = buildCombinedMethodTrack(rows)
    expect(track.n).toBe(0)
    expect(track.winRatePct).toBeNull()
  })

  it('empty input is provisional with no percentage', () => {
    const track = buildCombinedMethodTrack([])
    expect(track).toEqual({ correct: 0, resolved: 0, n: 0, winRatePct: null, provisional: true })
  })
})

describe('buildLeaderboardData', () => {
  it('computes primary + secondary slices from one row set, including scout', () => {
    const rows = [
      row({ model_id: 'a', camp: 'us', league_tier: 'premier', category: 'stock', is_correct: true }),
      row({ model_id: 'b', camp: 'china', league_tier: 'scout', category: 'fx', is_correct: false, predicted_direction: 'down' }),
    ]
    const data = buildLeaderboardData(rows)
    expect(data.minSample).toBe(LEADERBOARD_MIN_SAMPLE)
    expect(data.totalConsidered).toBe(2)
    expect(data.model.rows).toHaveLength(2)
    expect(data.campHeadline.rows).toHaveLength(2)
    expect(data.method.rows).toHaveLength(2)
    expect(data.tier.rows.some((r) => r.key === 'scout')).toBe(true)
    expect(data.korea.rows).toEqual([])
    expect(typeof data.generatedAt).toBe('string')
  })

  it('no slice ANYWHERE publishes a percentage or a rank for a below-threshold bucket', () => {
    // A realistic early state: one model with a real sample, the rest with one
    // or two graded rounds each, spread across camps, tiers, brands, categories.
    const rows = [
      ...rowsFor('deepseek-v4-pro', LEADERBOARD_MIN_SAMPLE + 3, 7, { camp: 'china', league_tier: 'premier', brand: 'DeepSeek' }),
      ...rowsFor('gpt-5.6-sol', 1, 1, { camp: 'us', league_tier: 'premier', brand: 'OpenAI' }),
      ...rowsFor('solar-pro-3', 2, 2, { camp: 'other', league_tier: 'world', brand: 'Upstage', category: 'fx' }),
      ...rowsFor('sonar-pro-2', 1, 0, { camp: 'us', league_tier: 'scout', brand: 'Perplexity', category: 'crypto' }),
    ]
    const data = buildLeaderboardData(rows)
    const scopes = ['model', 'campHeadline', 'method', 'camp', 'tier', 'brand', 'category', 'korea'] as const

    for (const scope of scopes) {
      for (const bucket of data[scope].rows) {
        if (bucket.n < data.minSample) {
          expect(bucket.winRatePct, `${scope}/${bucket.key}`).toBeNull()
          expect(bucket.rank, `${scope}/${bucket.key}`).toBeNull()
        } else {
          expect(bucket.winRatePct, `${scope}/${bucket.key}`).not.toBeNull()
        }
      }
      // Ranks, where they exist, are a dense 1..k over the qualifying rows only.
      const ranks = data[scope].rows.map((r) => r.rank).filter((r): r is number => r !== null)
      expect(ranks).toEqual(Array.from({ length: data[scope].rankedRows }, (_, i) => i + 1))
    }
  })

  it('empty input yields empty slices everywhere, never throws', () => {
    const data = buildLeaderboardData([])
    expect(data.model.rows).toEqual([])
    expect(data.campHeadline.rows).toEqual([])
    expect(data.method.rows).toEqual([])
    expect(data.camp.rows).toEqual([])
    expect(data.tier.rows).toEqual([])
    expect(data.brand.rows).toEqual([])
    expect(data.category.rows).toEqual([])
    expect(data.korea.rows).toEqual([])
    expect(data.combined.n).toBe(0)
    expect(data.totalConsidered).toBe(0)
    expect(data.baselines.alwaysUp.n).toBe(0)
    expect(data.baselines.coinFlip.winRatePct).toBeNull()
  })
})
