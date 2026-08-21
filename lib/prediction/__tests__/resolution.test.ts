import { describe, expect, it } from 'vitest'
import {
  precheckResolutionWindow,
  resolveRoundOutcome,
  selectResolutionSession,
  type DailyBar,
  type RoundResolutionInput,
  type SeriesResult,
} from '../resolution'

/**
 * The real shape of the first ranked AAPL round: opened 2026-08-18 03:12 UTC
 * (outside US market hours, so its anchor is the Aug 17 close) and due 24h
 * later. Correct grading uses the Aug 18 session close.
 */
const AAPL_ROUND: RoundResolutionInput = {
  instrument: 'AAPL',
  anchorPrice: 305.59,
  anchorPriceAt: '2026-08-18T03:12:41.103Z',
  resolvesAt: '2026-08-19T03:12:40.674Z',
}

const AAPL_BARS: DailyBar[] = [
  { sessionDate: '2026-08-17', close: 305.59 },
  { sessionDate: '2026-08-18', close: 311.2 },
  { sessionDate: '2026-08-19', close: 288.4 },
]

function series(bars: DailyBar[]): SeriesResult {
  return { ok: true, bars }
}

describe('selectResolutionSession', () => {
  it('picks the session that closed inside the window, not the anchor session and not a later one', () => {
    const anchorMs = Date.parse(AAPL_ROUND.anchorPriceAt!)
    const resolvesMs = Date.parse(AAPL_ROUND.resolvesAt)
    expect(selectResolutionSession(AAPL_BARS, anchorMs, resolvesMs)?.sessionDate).toBe('2026-08-18')
  })
})

describe('resolveRoundOutcome — graded rounds', () => {
  it('grades an up-call correctly (resolution close above the persisted anchor)', () => {
    const result = resolveRoundOutcome({ ...AAPL_ROUND, series: series(AAPL_BARS) })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.outcome.actualDirection).toBe('up')
    expect(result.outcome.anchorPrice).toBe(305.59)
    expect(result.outcome.resolutionPrice).toBe(311.2)
    expect(result.outcome.resolutionSessionDate).toBe('2026-08-18')
    expect(result.outcome.rawOutcome).toContain('up')
    expect(result.outcome.rawOutcome).toContain('311.2')
    expect(result.outcome.rawOutcome).toContain('2026-08-18')
  })

  it('grades a down-call correctly (resolution close below the persisted anchor)', () => {
    const result = resolveRoundOutcome({
      ...AAPL_ROUND,
      series: series([
        { sessionDate: '2026-08-17', close: 305.59 },
        { sessionDate: '2026-08-18', close: 299.01 },
      ]),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.outcome.actualDirection).toBe('down')
    expect(result.outcome.resolutionPrice).toBe(299.01)
    expect(result.outcome.resolutionSessionDate).toBe('2026-08-18')
  })

  it('is time-invariant: the same round graded days late yields the same session and grade', () => {
    // A late pass sees MORE bars (the days after the deadline). None may leak in.
    const late = resolveRoundOutcome({
      ...AAPL_ROUND,
      series: series([
        ...AAPL_BARS,
        { sessionDate: '2026-08-20', close: 260.0 },
        { sessionDate: '2026-08-21', close: 250.0 },
      ]),
    })
    const onTime = resolveRoundOutcome({ ...AAPL_ROUND, series: series(AAPL_BARS) })
    expect(late).toEqual(onTime)
    expect(late.ok && late.outcome.resolutionSessionDate).toBe('2026-08-18')
  })

  it('never grades against a tiny move via a flat band — a 0.01 move is still a real up', () => {
    const result = resolveRoundOutcome({
      ...AAPL_ROUND,
      series: series([{ sessionDate: '2026-08-18', close: 305.6 }]),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.outcome.actualDirection).toBe('up')
  })
})

describe('resolveRoundOutcome — ungraded rounds (never guess)', () => {
  it('refuses to grade when anchor_price is null', () => {
    const result = resolveRoundOutcome({ ...AAPL_ROUND, anchorPrice: null, series: series(AAPL_BARS) })
    expect(result).toMatchObject({ ok: false, reason: 'missing_anchor' })
  })

  it('refuses to grade when anchor_price has no observation time', () => {
    const result = resolveRoundOutcome({ ...AAPL_ROUND, anchorPriceAt: null, series: series(AAPL_BARS) })
    expect(result).toMatchObject({ ok: false, reason: 'missing_anchor' })
  })

  it('refuses to grade a weekend window where no session closed', () => {
    // Anchor observed Saturday; the only bars are the preceding weekdays.
    const result = resolveRoundOutcome({
      instrument: 'AAPL',
      anchorPrice: 305.59,
      anchorPriceAt: '2026-08-22T09:00:00.000Z',
      resolvesAt: '2026-08-23T09:00:00.000Z',
      series: series([
        { sessionDate: '2026-08-20', close: 301.0 },
        { sessionDate: '2026-08-21', close: 305.59 },
      ]),
    })
    expect(result).toMatchObject({ ok: false, reason: 'no_session_in_window' })
  })

  it('refuses to grade when the time_series call fails', () => {
    const result = resolveRoundOutcome({
      ...AAPL_ROUND,
      series: { ok: false, error: 'HTTP 429 Too Many Requests' },
    })
    expect(result).toMatchObject({ ok: false, reason: 'series_unavailable' })
    expect(result.ok === false && result.detail).toContain('429')
  })

  it('refuses to grade when the series comes back empty', () => {
    const result = resolveRoundOutcome({ ...AAPL_ROUND, series: series([]) })
    expect(result).toMatchObject({ ok: false, reason: 'no_series_data' })
  })

  it('refuses to grade an exactly equal close — nobody is wrong, so nobody is graded', () => {
    const result = resolveRoundOutcome({
      ...AAPL_ROUND,
      series: series([{ sessionDate: '2026-08-18', close: 305.59 }]),
    })
    expect(result).toMatchObject({ ok: false, reason: 'equal_close' })
  })

  it('refuses to grade against the anchor\u2019s own session (anchor taken from that close)', () => {
    // Anchor observed after Friday's close, deadline over the weekend: the only
    // in-window bar IS the anchor's own session, so its close equals the anchor.
    const result = resolveRoundOutcome({
      instrument: 'AAPL',
      anchorPrice: 305.59,
      anchorPriceAt: '2026-08-21T20:30:00.000Z',
      resolvesAt: '2026-08-22T20:30:00.000Z',
      series: series([
        { sessionDate: '2026-08-20', close: 301.0 },
        { sessionDate: '2026-08-21', close: 305.59 },
      ]),
    })
    expect(result).toMatchObject({ ok: false, reason: 'equal_close' })
  })

  it('refuses a window whose deadline is not after the anchor observation', () => {
    const result = resolveRoundOutcome({
      ...AAPL_ROUND,
      resolvesAt: '2026-08-18T03:12:41.103Z',
      series: series(AAPL_BARS),
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_window' })
  })
})

describe('precheckResolutionWindow (runs before any price-feed call)', () => {
  it('short-circuits an anchorless round so grading never spends a feed credit', () => {
    expect(precheckResolutionWindow({ ...AAPL_ROUND, anchorPrice: null })).toMatchObject({
      reason: 'missing_anchor',
    })
  })

  it('passes a usable window', () => {
    expect(precheckResolutionWindow(AAPL_ROUND)).toBeNull()
  })
})
