import { describe, expect, it } from 'vitest'
import {
  alignByDate,
  computeRelatedStats,
  LEAD_LAG_MIN_ABS_R,
  logReturns,
  pearson,
  RELATED_CORR_WINDOW,
} from '../related-stats'
import type { SeriesBar } from '../closed-book-packet'

function isoDate(i: number): string {
  const d = new Date(Date.UTC(2026, 0, 1 + i))
  return d.toISOString().slice(0, 10)
}

/** Deterministic wiggly returns (no short repeating cycle). */
function syntheticReturns(n: number, phase = 0): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push(Math.sin(i * 1.7 + phase) * 0.01 + Math.cos(i * 0.9 + phase * 2) * 0.005)
  }
  return out
}

function barsFromReturns(rets: number[], start = 100): SeriesBar[] {
  const out: SeriesBar[] = [{ date: isoDate(0), close: start }]
  let px = start
  for (let i = 0; i < rets.length; i++) {
    px = px * Math.exp(rets[i])
    out.push({ date: isoDate(i + 1), close: Number(px.toFixed(6)) })
  }
  return out
}

describe('related-stats — pure math', () => {
  it('pearson: identical return streams correlate at 1', () => {
    const x = syntheticReturns(30)
    expect(pearson(x, x)).toBeCloseTo(1, 8)
  })

  it('pearson: returns null below the minimum-pairs floor and on zero variance', () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeNull()
    const flat = Array(20).fill(0.5)
    expect(pearson(flat, syntheticReturns(20))).toBeNull()
  })

  it('beta: anchor moving 2x the related series has beta ≈ 2', () => {
    const base = syntheticReturns(80)
    const anchor = barsFromReturns(base.map((r) => r * 2))
    const related = barsFromReturns(base)
    const stats = computeRelatedStats(anchor, related)
    expect(stats).not.toBeNull()
    expect(stats!.corr!.r).toBeCloseTo(1, 6)
    expect(stats!.corr!.n).toBe(RELATED_CORR_WINDOW)
    expect(stats!.beta!.beta).toBeCloseTo(2, 6)
  })

  it('lead-lag: a related series that leads the anchor by 1 session is detected at t-1', () => {
    const rets = syntheticReturns(80)
    // Anchor's return at t equals related's return at t-1 → related LEADS by 1.
    const related = barsFromReturns(rets)
    const anchor = barsFromReturns([0, ...rets.slice(0, -1)])
    const stats = computeRelatedStats(anchor, related)
    expect(stats).not.toBeNull()
    const lag1 = stats!.leadLag.find((l) => l.lag === 1)
    expect(lag1).toBeDefined()
    expect(lag1!.r).toBeGreaterThan(0.9)
    expect(lag1!.n).toBeGreaterThanOrEqual(10)
  })

  it('lead-lag: every printed entry clears the |r| threshold', () => {
    const anchor = barsFromReturns(syntheticReturns(80, 0))
    const related = barsFromReturns(syntheticReturns(80, 3.1))
    const stats = computeRelatedStats(anchor, related)
    expect(stats).not.toBeNull()
    for (const l of stats!.leadLag) {
      expect(Math.abs(l.r)).toBeGreaterThanOrEqual(LEAD_LAG_MIN_ABS_R)
    }
  })

  it('alignByDate: only shared session dates survive (equity vs 7-day series)', () => {
    const anchor: SeriesBar[] = [
      { date: '2026-01-05', close: 100 }, // Mon
      { date: '2026-01-06', close: 101 },
      { date: '2026-01-07', close: 102 },
    ]
    const related: SeriesBar[] = [
      { date: '2026-01-04', close: 50 }, // Sun — anchor has no bar
      { date: '2026-01-05', close: 51 },
      { date: '2026-01-06', close: 52 },
      { date: '2026-01-07', close: 53 },
    ]
    const { a, b } = alignByDate(anchor, related)
    expect(a).toEqual([100, 101, 102])
    expect(b).toEqual([51, 52, 53])
  })

  it('logReturns skips non-positive prices instead of producing NaN', () => {
    expect(logReturns([100, 0, 110]).every(Number.isFinite)).toBe(true)
  })

  it('move1dPct comes from the related series own last two bars', () => {
    const related: SeriesBar[] = [
      { date: '2026-01-05', close: 100 },
      { date: '2026-01-06', close: 103 },
    ]
    const anchor = barsFromReturns(syntheticReturns(30))
    const stats = computeRelatedStats(anchor, related)
    expect(stats).not.toBeNull()
    expect(stats!.move1dPct).toBeCloseTo(3, 6)
    expect(stats!.lastClose).toBe(103)
    // Too few aligned bars for corr — must be null, never a guess.
    expect(stats!.corr).toBeNull()
  })
})
