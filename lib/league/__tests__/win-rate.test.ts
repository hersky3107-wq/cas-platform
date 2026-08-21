import { describe, expect, it } from 'vitest'
import { MIN_GRADED_ROUNDS_FOR_WIN_RATE } from '../credits'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { LEAGUE_UI, getLeagueUiPack } from '../i18n/dictionary'
import {
  WIN_RATE_MIN_SAMPLE,
  formatWinRatePct,
  isDisplayableWinRate,
  truncateWinRatePct,
  winRateDisplay,
  winRateLabel,
  winRatePctForDisplay,
} from '../win-rate'

const en = LEAGUE_UI.en

describe('minimum-sample gate', () => {
  it('uses the shared named constant, not a local copy', () => {
    expect(WIN_RATE_MIN_SAMPLE).toBe(MIN_GRADED_ROUNDS_FOR_WIN_RATE)
    expect(MIN_GRADED_ROUNDS_FOR_WIN_RATE).toBe(10)
  })

  it('refuses a percentage below the threshold and allows it exactly at the threshold', () => {
    for (let n = 0; n < WIN_RATE_MIN_SAMPLE; n += 1) {
      expect(isDisplayableWinRate(n)).toBe(false)
      expect(winRatePctForDisplay(n, n)).toBeNull()
    }
    expect(isDisplayableWinRate(WIN_RATE_MIN_SAMPLE)).toBe(true)
    expect(winRatePctForDisplay(WIN_RATE_MIN_SAMPLE, WIN_RATE_MIN_SAMPLE)).toBe(100)
  })

  it('the 1-round 100% case renders a record, with no percent sign anywhere', () => {
    const display = winRateDisplay(1, 1)
    expect(display.kind).toBe('insufficient')
    expect(display).not.toHaveProperty('pct')
    const label = winRateLabel(display, en)
    expect(label).toBe('1W 0L (sample too small)')
    expect(label).not.toContain('%')
    expect(label).not.toContain('100')
  })

  it('reports the empty state distinctly from a low sample', () => {
    expect(winRateDisplay(0, 0)).toEqual({ kind: 'empty' })
    expect(winRateLabel(winRateDisplay(0, 0), en)).toBe(en.winRate.noRounds)
  })
})

describe('truncation (never rounds a claim upward)', () => {
  it('truncates instead of rounding', () => {
    expect(truncateWinRatePct(2, 3)).toBe(66.6)
    expect(truncateWinRatePct(5, 6)).toBe(83.3)
    expect(truncateWinRatePct(7, 12)).toBe(58.3)
    // 0.9995 would round to 100% — truncation keeps it below.
    expect(truncateWinRatePct(1999, 2000)).toBe(99.9)
  })

  it('never returns a value above the true ratio', () => {
    for (let resolved = 1; resolved <= 40; resolved += 1) {
      for (let correct = 0; correct <= resolved; correct += 1) {
        const pct = truncateWinRatePct(correct, resolved)
        expect(pct).toBeLessThanOrEqual((correct / resolved) * 100 + 1e-9)
      }
    }
  })

  it('formats integers bare and keeps one decimal otherwise', () => {
    expect(formatWinRatePct(100)).toBe('100')
    expect(formatWinRatePct(0)).toBe('0')
    expect(formatWinRatePct(66.6)).toBe('66.6')
  })
})

describe('a displayed percentage always carries its sample size', () => {
  it('includes n at the threshold and at the extremes (100% / 0%)', () => {
    const perfect = winRateDisplay(WIN_RATE_MIN_SAMPLE, WIN_RATE_MIN_SAMPLE)
    expect(winRateLabel(perfect, en)).toBe(`100% (n=${WIN_RATE_MIN_SAMPLE})`)
    const zero = winRateDisplay(0, WIN_RATE_MIN_SAMPLE)
    expect(winRateLabel(zero, en)).toBe(`0% (n=${WIN_RATE_MIN_SAMPLE})`)
    expect(winRateLabel(winRateDisplay(21, 34), en)).toBe('61.7% (n=34)')
  })

  it('holds in every locale — a percentage is never emitted without its n', () => {
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      for (const [correct, resolved] of [
        [34, 34],
        [0, 34],
        [21, 34],
      ] as const) {
        const label = winRateLabel(winRateDisplay(correct, resolved), pack)
        expect(label, locale).toContain('%')
        expect(label, locale).toContain(String(resolved))
      }
      // And below the threshold, no locale can produce a percentage at all.
      expect(winRateLabel(winRateDisplay(1, 1), pack), locale).not.toContain('%')
    }
  })
})
