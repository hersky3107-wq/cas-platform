import { describe, expect, it } from 'vitest'
import {
  LEADERBOARD_PROVISIONAL_THRESHOLD,
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
  it('counts a round as correct when the majority direction was right', () => {
    const rows = [
      row({ round_id: 'r1', predicted_direction: 'up', is_correct: true, model_id: 'a' }),
      row({ round_id: 'r1', predicted_direction: 'up', is_correct: true, model_id: 'b' }),
      row({ round_id: 'r1', predicted_direction: 'down', is_correct: false, model_id: 'c' }),
    ]
    const track = buildCombinedMethodTrack(rows)
    expect(track.n).toBe(1)
    expect(track.correct).toBe(1)
    expect(track.winRatePct).toBe(100)
    expect(track.provisional).toBe(true)
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
    expect(data.totalConsidered).toBe(2)
    expect(data.model.rows).toHaveLength(2)
    expect(data.campHeadline.rows).toHaveLength(2)
    expect(data.method.rows).toHaveLength(2)
    expect(data.tier.rows.some((r) => r.key === 'scout')).toBe(true)
    expect(data.korea.rows).toEqual([])
    expect(typeof data.generatedAt).toBe('string')
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
  })
})
