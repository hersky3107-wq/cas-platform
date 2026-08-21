import { describe, expect, it } from 'vitest'
import { cardStatusCopy, cardStatusKind } from '../card-status'
import { presentCardGrading } from '../card-aggregate'
import { LEAGUE_UI } from '../i18n/dictionary'

const en = LEAGUE_UI.en
const NOW = Date.parse('2026-08-21T12:00:00.000Z')

const due = {
  resolves_at: '2026-08-19T03:12:40.000Z',
  actual_outcome: null,
  resolved_at: null,
  grading_busy_until: null,
  grading_attempted_at: null,
  unresolvable_reason: null as string | null,
  anchor_price: null as number | null,
}

describe('presentCardGrading + card status — unresolvable never looks like grading', () => {
  it('a due round with no anchor is unresolvable/missing_anchor, not grading', () => {
    const presented = presentCardGrading(due, NOW)
    expect(presented.gradingState).toBe('unresolvable')
    expect(presented.unresolvableReason).toBe('missing_anchor')

    const kind = cardStatusKind({ gradingState: presented.gradingState }, { graded: 0 }, false)
    expect(kind).toBe('unresolvable')
    expect(kind).not.toBe('grading')

    const copy = cardStatusCopy(kind, presented.unresolvableReason, en)
    expect(copy.badge).toBe(en.grading.unresolvable)
    expect(copy.badge).not.toBe(en.grading.inProgress)
    expect(copy.note).toBe(en.grading.reason.missing_anchor)
  })

  it('a persisted unresolvable reason never renders the in-progress string', () => {
    for (const reason of [
      'missing_anchor',
      'equal_close',
      'no_session_in_window',
      'series_unavailable',
      'invalid_window',
    ]) {
      const presented = presentCardGrading({ ...due, unresolvable_reason: reason }, NOW)
      expect(presented.gradingState).toBe('unresolvable')
      const kind = cardStatusKind({ gradingState: presented.gradingState }, { graded: 0 }, false)
      const copy = cardStatusCopy(kind, presented.unresolvableReason, en)
      expect(copy.badge).not.toBe(en.grading.inProgress)
      expect(kind).not.toBe('grading')
    }
  })

  it('a live claim lease is the only state that may show as grading', () => {
    const presented = presentCardGrading(
      { ...due, grading_busy_until: '2026-08-21T12:01:00.000Z', anchor_price: 305.59 },
      NOW
    )
    expect(presented.gradingState).toBe('grading')
    expect(cardStatusKind({ gradingState: presented.gradingState }, { graded: 0 }, false)).toBe('grading')
    expect(cardStatusKind({ gradingState: presented.gradingState }, { graded: 0 }, true)).toBe('stalled')
  })
})
