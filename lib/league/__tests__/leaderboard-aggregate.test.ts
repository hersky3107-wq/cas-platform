import { describe, expect, it } from 'vitest'
import {
  LEADERBOARD_PROVISIONAL_THRESHOLD,
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
    ...overrides,
  }
}

describe('buildLeaderboardSlice', () => {
  it('groups per-model win rate with correct/resolved/n', () => {
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
    expect(a.winRatePct).toBeCloseTo(66.7, 1)
    const b = slice.rows.find((r) => r.key === 'b')!
    expect(b.correct).toBe(0)
    expect(b.resolved).toBe(1)
    expect(b.winRatePct).toBe(0)
  })

  it('sorts descending by win rate, tie-broken by larger sample size', () => {
    const rows = [
      row({ model_id: 'low-n-perfect', is_correct: true }),
      row({ model_id: 'high-n-good', is_correct: true }),
      row({ model_id: 'high-n-good', is_correct: true }),
      row({ model_id: 'high-n-good', is_correct: false }),
    ]
    const slice = buildLeaderboardSlice(rows, 'model')
    // low-n-perfect is 100% (n=1); high-n-good is 66.7% (n=3) — 100% still wins.
    expect(slice.rows[0]!.key).toBe('low-n-perfect')
    expect(slice.rows[0]!.winRatePct).toBe(100)
    expect(slice.rows[0]!.provisional).toBe(true)
  })

  it('flags rows below the provisional threshold and not rows at/above it', () => {
    const belowRows: GradedPredictionRow[] = Array.from({ length: LEADERBOARD_PROVISIONAL_THRESHOLD - 1 }, () =>
      row({ model_id: 'below' })
    )
    const atRows: GradedPredictionRow[] = Array.from({ length: LEADERBOARD_PROVISIONAL_THRESHOLD }, () =>
      row({ model_id: 'at' })
    )
    const slice = buildLeaderboardSlice([...belowRows, ...atRows], 'model')
    expect(slice.rows.find((r) => r.key === 'below')!.provisional).toBe(true)
    expect(slice.rows.find((r) => r.key === 'at')!.provisional).toBe(false)
  })

  it('a 1-for-1 model is 100% but still provisional (n carried alongside)', () => {
    const slice = buildLeaderboardSlice([row({ model_id: 'solo', is_correct: true })], 'model')
    const solo = slice.rows[0]!
    expect(solo.winRatePct).toBe(100)
    expect(solo.n).toBe(1)
    expect(solo.provisional).toBe(true)
  })

  it('camp scope buckets by camp key with a human label', () => {
    const rows = [row({ camp: 'us' }), row({ camp: 'china', is_correct: false })]
    const slice = buildLeaderboardSlice(rows, 'camp')
    const us = slice.rows.find((r) => r.key === 'us')!
    const cn = slice.rows.find((r) => r.key === 'china')!
    expect(us.label).toBe('US')
    expect(cn.label).toBe('China')
  })

  it('tier scope never produces a scout bucket even if one somehow slips through', () => {
    const rows = [row({ league_tier: 'premier' }), row({ league_tier: 'scout' })]
    const slice = buildLeaderboardSlice(rows, 'tier')
    expect(slice.rows.some((r) => r.key === 'scout')).toBe(false)
  })

  it('category scope formats underscores as spaces (technical label, not translated)', () => {
    const slice = buildLeaderboardSlice([row({ category: 'crypto_spot' })], 'category')
    expect(slice.rows[0]!.label).toBe('crypto spot')
  })

  it('a slice with zero rows has no entries and no NaN', () => {
    const slice = buildLeaderboardSlice([], 'model')
    expect(slice.rows).toEqual([])
    expect(slice.totalResolved).toBe(0)
  })
})

describe('buildLeaderboardData', () => {
  it('computes all four slices from one row set in a single pass', () => {
    const rows = [
      row({ model_id: 'a', camp: 'us', league_tier: 'premier', category: 'stock', is_correct: true }),
      row({ model_id: 'b', camp: 'china', league_tier: 'challenger', category: 'fx', is_correct: false }),
    ]
    const data = buildLeaderboardData(rows)
    expect(data.totalConsidered).toBe(2)
    expect(data.model.rows).toHaveLength(2)
    expect(data.camp.rows).toHaveLength(2)
    expect(data.tier.rows).toHaveLength(2)
    expect(data.category.rows).toHaveLength(2)
    expect(typeof data.generatedAt).toBe('string')
  })

  it('empty input yields empty slices everywhere, never throws', () => {
    const data = buildLeaderboardData([])
    expect(data.model.rows).toEqual([])
    expect(data.camp.rows).toEqual([])
    expect(data.tier.rows).toEqual([])
    expect(data.category.rows).toEqual([])
    expect(data.totalConsidered).toBe(0)
  })
})
