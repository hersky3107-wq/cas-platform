import { describe, expect, it } from 'vitest'
import {
  GRADING_READ_COOLDOWN_MS,
  gradingStateOf,
  isReadCooldownActive,
  type GradingStateRow,
} from '../grading-state'

const NOW = Date.parse('2026-08-21T12:00:00.000Z')

function row(overrides: Partial<GradingStateRow> = {}): GradingStateRow {
  return {
    resolves_at: '2026-08-20T00:00:00.000Z',
    actual_outcome: null,
    resolved_at: null,
    grading_busy_until: null,
    grading_attempted_at: null,
    unresolvable_reason: null,
    ...overrides,
  }
}

describe('gradingStateOf — one null is not one state', () => {
  it('is not_due before the deadline', () => {
    expect(gradingStateOf(row({ resolves_at: '2026-08-22T00:00:00.000Z' }), NOW)).toBe('not_due')
  })

  it('is due_ungraded once the deadline passed with no attempt on record', () => {
    expect(gradingStateOf(row(), NOW)).toBe('due_ungraded')
  })

  it('is grading while a claim lease is live', () => {
    expect(gradingStateOf(row({ grading_busy_until: '2026-08-21T12:01:00.000Z' }), NOW)).toBe('grading')
  })

  it('treats an EXPIRED lease as claimable again, not as grading', () => {
    expect(gradingStateOf(row({ grading_busy_until: '2026-08-21T11:00:00.000Z' }), NOW)).toBe('due_ungraded')
  })

  it('is unresolvable when the last attempt recorded a reason', () => {
    expect(gradingStateOf(row({ unresolvable_reason: 'equal_close' }), NOW)).toBe('unresolvable')
  })

  it('reports a retry in flight as grading, not as unresolvable', () => {
    const state = gradingStateOf(
      row({ unresolvable_reason: 'series_unavailable', grading_busy_until: '2026-08-21T12:01:00.000Z' }),
      NOW
    )
    expect(state).toBe('grading')
  })

  it('is graded as soon as an outcome exists, whatever else the row says', () => {
    expect(gradingStateOf(row({ actual_outcome: 'up (…)' }), NOW)).toBe('graded')
    expect(gradingStateOf(row({ resolved_at: '2026-08-20T01:00:00.000Z' }), NOW)).toBe('graded')
    expect(
      gradingStateOf(row({ actual_outcome: 'up (…)', unresolvable_reason: 'equal_close' }), NOW)
    ).toBe('graded')
  })

  it('does not call an unparseable deadline "due"', () => {
    expect(gradingStateOf(row({ resolves_at: 'not-a-date' }), NOW)).toBe('not_due')
  })
})

describe('isReadCooldownActive', () => {
  it('is inactive when grading was never attempted', () => {
    expect(isReadCooldownActive(row(), NOW)).toBe(false)
  })

  it('is active right after an attempt and inactive once the window passes', () => {
    const justNow = new Date(NOW - 1_000).toISOString()
    const longAgo = new Date(NOW - GRADING_READ_COOLDOWN_MS - 1_000).toISOString()
    expect(isReadCooldownActive(row({ grading_attempted_at: justNow }), NOW)).toBe(true)
    expect(isReadCooldownActive(row({ grading_attempted_at: longAgo }), NOW)).toBe(false)
  })
})
