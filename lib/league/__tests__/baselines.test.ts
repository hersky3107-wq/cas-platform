import { describe, expect, it } from 'vitest'
import {
  COIN_FLIP_EXPECTED_PCT,
  actualDirectionFromGraded,
  actualDirectionsByRound,
  alwaysUpRecordOf,
  beatsRecord,
  buildBaselineSummary,
  emptyBaselineSummary,
} from '../baselines'
import { LEADERBOARD_MIN_SAMPLE, buildLeaderboardData, type GradedPredictionRow } from '../leaderboard-aggregate'

function row(overrides: Partial<GradedPredictionRow> = {}): GradedPredictionRow {
  return {
    model_id: 'a',
    brand: 'A',
    camp: 'us',
    league_tier: 'premier',
    category: 'stock',
    is_correct: true,
    round_id: 'r1',
    predicted_direction: 'up',
    ...overrides,
  }
}

describe('actualDirectionFromGraded', () => {
  it('recovers up/down from the already-graded (direction, is_correct) pair', () => {
    expect(actualDirectionFromGraded(row({ predicted_direction: 'up', is_correct: true }))).toBe('up')
    expect(actualDirectionFromGraded(row({ predicted_direction: 'up', is_correct: false }))).toBe('down')
    expect(actualDirectionFromGraded(row({ predicted_direction: 'down', is_correct: true }))).toBe('down')
    expect(actualDirectionFromGraded(row({ predicted_direction: 'down', is_correct: false }))).toBe('up')
  })

  it('refuses a flat or missing direction rather than guessing', () => {
    expect(actualDirectionFromGraded(row({ predicted_direction: 'flat', is_correct: true }))).toBeNull()
    expect(actualDirectionFromGraded(row({ predicted_direction: null, is_correct: true }))).toBeNull()
  })
})

describe('alwaysUpRecordOf — mixed up/down rounds', () => {
  it('scores Always up from the actuals, not from a hardcoded rate', () => {
    // r1 went up (model called up, correct), r2 went down (model called up, wrong),
    // r3 went down (model called down, correct), r4 went up (model called down, wrong).
    const rows = [
      row({ round_id: 'r1', predicted_direction: 'up', is_correct: true }),
      row({ round_id: 'r2', predicted_direction: 'up', is_correct: false }),
      row({ round_id: 'r3', predicted_direction: 'down', is_correct: true }),
      row({ round_id: 'r4', predicted_direction: 'down', is_correct: false }),
    ]
    expect(alwaysUpRecordOf(rows)).toEqual({ correct: 2, resolved: 4 })
  })

  it('counts each round once even when forty models were graded on it', () => {
    const rows = [
      row({ round_id: 'r1', model_id: 'a', predicted_direction: 'up', is_correct: true }),
      row({ round_id: 'r1', model_id: 'b', predicted_direction: 'down', is_correct: false }),
      row({ round_id: 'r1', model_id: 'c', predicted_direction: 'up', is_correct: true }),
      row({ round_id: 'r2', model_id: 'a', predicted_direction: 'down', is_correct: true }),
      row({ round_id: 'r2', model_id: 'b', predicted_direction: 'down', is_correct: true }),
    ]
    expect(alwaysUpRecordOf(rows)).toEqual({ correct: 1, resolved: 2 })
  })

  it('drops a round whose graded rows disagree about the actual, rather than guessing', () => {
    const rows = [
      row({ round_id: 'r1', model_id: 'a', predicted_direction: 'up', is_correct: true }),
      row({ round_id: 'r1', model_id: 'b', predicted_direction: 'up', is_correct: false }),
    ]
    expect(alwaysUpRecordOf(rows)).toEqual({ correct: 0, resolved: 0 })
    expect(actualDirectionsByRound(rows).size).toBe(0)
  })

  it('is all-correct when every graded round actually went up', () => {
    const rows = [
      row({ round_id: 'r1', predicted_direction: 'up', is_correct: true }),
      row({ round_id: 'r2', predicted_direction: 'down', is_correct: false }),
    ]
    expect(alwaysUpRecordOf(rows)).toEqual({ correct: 2, resolved: 2 })
  })

  it('is all-wrong when every graded round actually went down', () => {
    const rows = [
      row({ round_id: 'r1', predicted_direction: 'up', is_correct: false }),
      row({ round_id: 'r2', predicted_direction: 'down', is_correct: true }),
    ]
    expect(alwaysUpRecordOf(rows)).toEqual({ correct: 0, resolved: 2 })
  })
})

describe('buildBaselineSummary', () => {
  it('publishes no percentage for Always up or Coin flip below the minimum sample', () => {
    const rows = [
      row({ round_id: 'r1', model_id: 'a', predicted_direction: 'up', is_correct: true }),
      row({ round_id: 'r1', model_id: 'b', predicted_direction: 'up', is_correct: true }),
    ]
    const summary = buildBaselineSummary(rows)
    expect(summary.alwaysUp.n).toBe(1)
    expect(summary.alwaysUp.correct).toBe(1)
    expect(summary.alwaysUp.winRatePct).toBeNull()
    expect(summary.alwaysUp.rank).toBeNull()
    expect(summary.coinFlip.winRatePct).toBeNull()
    expect(summary.coinFlip.role).toBe('marker')
    expect(summary.coinFlip.correct).toBe(0)
  })

  it('publishes Always up from the actuals and Coin flip as a fixed 50% line at the threshold', () => {
    const rows = Array.from({ length: LEADERBOARD_MIN_SAMPLE }, (_, i) =>
      row({
        round_id: `r${i}`,
        predicted_direction: 'up',
        is_correct: i < 7,
      })
    )
    const summary = buildBaselineSummary(rows)
    expect(summary.alwaysUp.correct).toBe(7)
    expect(summary.alwaysUp.resolved).toBe(LEADERBOARD_MIN_SAMPLE)
    expect(summary.alwaysUp.winRatePct).toBe(70)
    expect(summary.coinFlip.winRatePct).toBe(COIN_FLIP_EXPECTED_PCT)
    expect(summary.coinFlip.n).toBe(LEADERBOARD_MIN_SAMPLE)
    // Coin flip is a marker: the 50 is not a simulated win count.
    expect(summary.coinFlip.correct).toBe(0)
    expect(summary.coinFlip.role).toBe('marker')
  })

  it('counts how many models beat Always up, and does not count ties', () => {
    // 2 up, 1 down → Always up is 2/3.
    const rows = [
      row({ round_id: 'up-1', model_id: 'best', predicted_direction: 'up', is_correct: true }),
      row({ round_id: 'up-2', model_id: 'best', predicted_direction: 'up', is_correct: true }),
      row({ round_id: 'down-1', model_id: 'best', predicted_direction: 'down', is_correct: true }),
      row({ round_id: 'up-1', model_id: 'tied', predicted_direction: 'up', is_correct: true }),
      row({ round_id: 'up-2', model_id: 'tied', predicted_direction: 'up', is_correct: true }),
      row({ round_id: 'down-1', model_id: 'tied', predicted_direction: 'up', is_correct: false }),
      row({ round_id: 'up-1', model_id: 'worst', predicted_direction: 'down', is_correct: false }),
      row({ round_id: 'up-2', model_id: 'worst', predicted_direction: 'down', is_correct: false }),
      row({ round_id: 'down-1', model_id: 'worst', predicted_direction: 'up', is_correct: false }),
    ]
    const summary = buildBaselineSummary(rows)
    expect(summary.alwaysUp).toMatchObject({ correct: 2, resolved: 3 })
    expect(summary.modelsCompared).toBe(3)
    expect(summary.modelsBeatingAlwaysUp).toBe(1)
  })

  it('scores Always up on the same subset a model was graded on — sitting out does not invent a beat', () => {
    // Always up is 1/2 overall (r-up, r-down). The model only played the down
    // round and got it right: 1/1 vs Always up's 0/1 on that subset → beats.
    const rows = [
      row({ round_id: 'r-up', model_id: 'other', predicted_direction: 'up', is_correct: true }),
      row({ round_id: 'r-down', model_id: 'other', predicted_direction: 'up', is_correct: false }),
      row({ round_id: 'r-down', model_id: 'specialist', predicted_direction: 'down', is_correct: true }),
    ]
    const summary = buildBaselineSummary(rows)
    expect(summary.alwaysUp).toMatchObject({ correct: 1, resolved: 2 })
    expect(summary.modelsBeatingAlwaysUp).toBe(1)
    expect(summary.modelsCompared).toBe(2)
  })

  it('empty input has nothing to compare and no percentages', () => {
    expect(buildBaselineSummary([])).toEqual(emptyBaselineSummary())
    expect(emptyBaselineSummary().alwaysUp.winRatePct).toBeNull()
    expect(emptyBaselineSummary().coinFlip.winRatePct).toBeNull()
  })
})

describe('beatsRecord', () => {
  it('compares ratios without floats', () => {
    expect(beatsRecord({ correct: 7, resolved: 10 }, { correct: 6, resolved: 10 })).toBe(true)
    expect(beatsRecord({ correct: 1, resolved: 2 }, { correct: 2, resolved: 4 })).toBe(false)
    expect(beatsRecord({ correct: 0, resolved: 0 }, { correct: 1, resolved: 1 })).toBe(false)
  })
})

describe('buildLeaderboardData carries baselines', () => {
  it('attaches the same Always up record the model slice was built from', () => {
    const rows = [
      row({ round_id: 'r1', model_id: 'good', predicted_direction: 'down', is_correct: true }),
      row({ round_id: 'r1', model_id: 'bad', predicted_direction: 'up', is_correct: false }),
    ]
    const data = buildLeaderboardData(rows)
    expect(data.baselines.alwaysUp.correct).toBe(0)
    expect(data.baselines.alwaysUp.resolved).toBe(1)
    expect(data.baselines.modelsBeatingAlwaysUp).toBe(1)
    expect(data.baselines.modelsCompared).toBe(2)
    expect(data.baselines.alwaysUp.rank).toBeNull()
    expect(data.baselines.coinFlip.rank).toBeNull()
  })

  it('empty leaderboard still exposes the baseline shape, never a fabricated rate', () => {
    const data = buildLeaderboardData([])
    expect(data.baselines.alwaysUp.n).toBe(0)
    expect(data.baselines.alwaysUp.winRatePct).toBeNull()
    expect(data.baselines.coinFlip.winRatePct).toBeNull()
    expect(data.baselines.modelsBeatingAlwaysUp).toBe(0)
  })
})
