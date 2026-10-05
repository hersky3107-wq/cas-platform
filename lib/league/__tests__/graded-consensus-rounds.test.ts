import { describe, expect, it } from 'vitest'
import {
  consensusHitsForCell,
  isGradedConsensusTrackRound,
  selectGradedConsensusTrackRounds,
} from '../graded-consensus-rounds'
import { computeLessonStats, type LessonSourceRound } from '../extra/lesson-stats'

function lessonRow(over: Partial<LessonSourceRound> = {}): LessonSourceRound {
  return {
    category: 'stock',
    horizon: '1d',
    instrument: 'AAPL',
    openedAt: '2026-08-17T21:30:00.000Z',
    gradingStatus: 'auto',
    unresolvableReason: null,
    actualOutcome: 'up',
    anchorSessionDate: null,
    resolutionSessionDate: '2026-08-17',
    consensusIsCorrect: true,
    majorityDirection: 'up',
    aggregateDirection: 'up',
    aggregateProbability: 70,
    majoritySharePct: 90,
    extras: {},
    ...over,
  }
}

describe('graded consensus track selector', () => {
  it('counts legacy auto-graded stock rounds without anchor_session_date', () => {
    const rows = [
      lessonRow({ id: 'a1', gradingStatus: 'auto', anchorSessionDate: null }),
      lessonRow({ id: 'a2', gradingStatus: 'graded', instrument: 'NVDA', consensusIsCorrect: false }),
      lessonRow({ id: 'skip', gradingStatus: 'voided', actualOutcome: 'up', consensusIsCorrect: true }),
      lessonRow({ id: 'skip2', actualOutcome: '', consensusIsCorrect: true }),
      lessonRow({ id: 'skip3', consensusIsCorrect: null }),
    ]
    const track = selectGradedConsensusTrackRounds(
      rows.map((r) => ({
        id: r.id,
        category: r.category,
        horizon: r.horizon,
        instrument: r.instrument,
        grading_status: r.gradingStatus,
        actual_outcome: r.actualOutcome,
        consensus_is_correct: r.consensusIsCorrect,
        anchor_session_date: r.anchorSessionDate,
        resolution_session_date: r.resolutionSessionDate,
      })),
    )
    expect(track.map((r) => r.id)).toEqual(['a1', 'a2'])
    expect(isGradedConsensusTrackRound({ category: 'stock', horizon: '1d', instrument: 'AAPL', grading_status: 'auto', actual_outcome: 'up', consensus_is_correct: true })).toBe(true)
  })

  it('does not drop stock rounds solely for legacy_same_day_window reason', () => {
    const row = lessonRow({
      unresolvableReason: 'legacy_same_day_window',
      gradingStatus: 'graded',
      instrument: 'AAPL',
    })
    expect(
      isGradedConsensusTrackRound({
        category: row.category,
        horizon: row.horizon,
        instrument: row.instrument,
        grading_status: row.gradingStatus,
        actual_outcome: row.actualOutcome,
        consensus_is_correct: row.consensusIsCorrect,
        unresolvable_reason: row.unresolvableReason,
      }),
    ).toBe(true)
  })

  it('keeps lesson notes and admin cell totals equal for the same fixture', () => {
    const fixture = [
      lessonRow({ id: '1', consensusIsCorrect: true }),
      lessonRow({ id: '2', instrument: 'MSFT', consensusIsCorrect: true, openedAt: '2026-08-21T21:30:00.000Z' }),
      lessonRow({ id: '3', instrument: 'NVDA', consensusIsCorrect: false, openedAt: '2026-08-27T21:30:00.000Z' }),
    ]
    const dbShape = fixture.map((r) => ({
      id: r.id,
      category: r.category,
      horizon: r.horizon,
      instrument: r.instrument,
      grading_status: r.gradingStatus,
      actual_outcome: r.actualOutcome,
      consensus_is_correct: r.consensusIsCorrect,
      anchor_session_date: r.anchorSessionDate,
      resolution_session_date: r.resolutionSessionDate,
    }))
    const adminCell = consensusHitsForCell(dbShape)
    const lesson = computeLessonStats(fixture)
    expect(lesson.n).toBe(adminCell.consensusN)
    expect(lesson.aiOverall).toEqual({ hits: adminCell.consensusHits, n: adminCell.consensusN })
  })
})
