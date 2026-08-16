import { describe, expect, it } from 'vitest'
import {
  buildRecordRoomEntries,
  buildRecordRoomPage,
  type RecordRoomPredictionRow,
  type RecordRoomRoundRow,
} from '../record-room-aggregate'

function round(overrides: Partial<RecordRoomRoundRow> = {}): RecordRoomRoundRow {
  return {
    id: 'round-1',
    proposition_text: 'Will AAPL close higher 24h from now?',
    category: 'stock',
    color_bucket: 'green',
    instrument: 'AAPL',
    resolved_at: '2026-08-16T21:31:00.000Z',
    actual_outcome: 'up',
    ...overrides,
  }
}

function pred(overrides: Partial<RecordRoomPredictionRow> = {}): RecordRoomPredictionRow {
  return {
    round_id: 'round-1',
    model_id: 'gpt-4o',
    brand: 'OpenAI',
    camp: 'us',
    league_tier: 'premier',
    predicted_direction: 'up',
    is_correct: true,
    ...overrides,
  }
}

describe('buildRecordRoomEntries', () => {
  it('attaches each round its own predictions, in round order', () => {
    const rounds = [round({ id: 'r1' }), round({ id: 'r2' })]
    const predictions = [
      pred({ round_id: 'r1', model_id: 'a' }),
      pred({ round_id: 'r2', model_id: 'b' }),
      pred({ round_id: 'r1', model_id: 'c' }),
    ]
    const entries = buildRecordRoomEntries(rounds, predictions)
    expect(entries.map((e) => e.round_id)).toEqual(['r1', 'r2'])
    expect(entries[0]!.models.map((m) => m.model_id)).toEqual(['a', 'c'])
    expect(entries[1]!.models.map((m) => m.model_id)).toEqual(['b'])
  })

  it('computes gradedCount/correctCount, ignoring ungraded (null) rows', () => {
    const rounds = [round({ id: 'r1' })]
    const predictions = [
      pred({ round_id: 'r1', model_id: 'a', is_correct: true }),
      pred({ round_id: 'r1', model_id: 'b', is_correct: false }),
      pred({ round_id: 'r1', model_id: 'c', is_correct: null, league_tier: 'scout' }),
    ]
    const [entry] = buildRecordRoomEntries(rounds, predictions)
    expect(entry!.gradedCount).toBe(2)
    expect(entry!.correctCount).toBe(1)
    expect(entry!.models).toHaveLength(3)
  })

  it('a round with no predictions yet renders an empty models list, not a crash', () => {
    const [entry] = buildRecordRoomEntries([round({ id: 'r1' })], [])
    expect(entry!.models).toEqual([])
    expect(entry!.gradedCount).toBe(0)
    expect(entry!.correctCount).toBe(0)
  })

  it('falls back an invalid color_bucket to yellow, same convention as card-aggregate', () => {
    const [entry] = buildRecordRoomEntries([round({ color_bucket: 'bogus' })], [])
    expect(entry!.color_bucket).toBe('yellow')
  })
})

describe('buildRecordRoomPage', () => {
  it('computes totalPages from totalRounds/pageSize', () => {
    const page = buildRecordRoomPage([round()], [], 1, 20, 45)
    expect(page.page).toBe(1)
    expect(page.pageSize).toBe(20)
    expect(page.totalRounds).toBe(45)
    expect(page.totalPages).toBe(3)
  })

  it('zero total rounds yields zero pages and an empty rounds array, never NaN', () => {
    const page = buildRecordRoomPage([], [], 1, 20, 0)
    expect(page.totalPages).toBe(0)
    expect(page.rounds).toEqual([])
  })
})
