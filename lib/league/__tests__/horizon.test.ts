import { describe, expect, it } from 'vitest'
import {
  addTradingDays,
  cacheBucketFor,
  computeResolvesAt,
  isUiHorizon,
  tradingApproximationNote,
  UI_HORIZONS,
  usesTradingSessions,
} from '../horizon'

describe('isUiHorizon', () => {
  it('accepts exactly the 4 fixed codes', () => {
    for (const h of UI_HORIZONS) expect(isUiHorizon(h)).toBe(true)
  })
  it('rejects everything else, including the retired internal codes', () => {
    // '24h'/'7d' were the OLD stored values before the vocabulary was unified;
    // they must now be rejected everywhere so a stale token cannot sneak in.
    for (const bad of ['24h', '7d', '2d', 'YOLO', '', 5, null, undefined]) {
      expect(isUiHorizon(bad)).toBe(false)
    }
  })
})

describe('usesTradingSessions', () => {
  it('is true only for stock / etf_index', () => {
    expect(usesTradingSessions('stock')).toBe(true)
    expect(usesTradingSessions('etf_index')).toBe(true)
    expect(usesTradingSessions('crypto_spot')).toBe(false)
    expect(usesTradingSessions('fx')).toBe(false)
    expect(usesTradingSessions('real_estate')).toBe(false)
  })
})

describe('addTradingDays', () => {
  it('skips weekends: Friday + 1 trading day lands on Monday', () => {
    const friday = Date.parse('2026-08-21T12:00:00.000Z') // a Friday
    const result = addTradingDays(friday, 1)
    expect(new Date(result).getUTCDay()).toBe(1) // Monday
    expect(new Date(result).toISOString().slice(0, 10)).toBe('2026-08-24')
  })

  it('5 trading days from a Monday lands on the following Monday', () => {
    const monday = Date.parse('2026-08-24T12:00:00.000Z')
    const result = addTradingDays(monday, 5)
    expect(new Date(result).toISOString().slice(0, 10)).toBe('2026-08-31')
  })
})

describe('computeResolvesAt', () => {
  const anchor = '2026-08-21T20:00:00.000Z' // a Friday

  it('equities/ETF: 1d resolves at the next trading session (skips the weekend)', () => {
    const resolvesAt = computeResolvesAt('stock', '1d', anchor)
    expect(resolvesAt.slice(0, 10)).toBe('2026-08-24')
  })

  it('crypto/FX: 1d resolves exactly 1 calendar day later, weekend included', () => {
    const resolvesAt = computeResolvesAt('crypto_spot', '1d', anchor)
    expect(resolvesAt.slice(0, 10)).toBe('2026-08-22')
  })

  it('equities: 1w/1m/3m use trading-session counts (5/21/63), never plain calendar days', () => {
    const oneWeek = computeResolvesAt('stock', '1w', anchor)
    const oneMonth = computeResolvesAt('stock', '1m', anchor)
    const threeMonths = computeResolvesAt('stock', '3m', anchor)
    // 5 trading days from a Friday anchor is more than 5 calendar days out.
    expect(Date.parse(oneWeek) - Date.parse(anchor)).toBeGreaterThan(6 * 24 * 60 * 60 * 1000)
    expect(Date.parse(oneMonth)).toBeGreaterThan(Date.parse(oneWeek))
    expect(Date.parse(threeMonths)).toBeGreaterThan(Date.parse(oneMonth))
  })

  it('crypto/FX: 1w/1m/3m are flat calendar-day counts (7/30/90)', () => {
    const base = Date.parse(anchor)
    expect(computeResolvesAt('fx', '1w', anchor)).toBe(new Date(base + 7 * 86_400_000).toISOString())
    expect(computeResolvesAt('fx', '1m', anchor)).toBe(new Date(base + 30 * 86_400_000).toISOString())
    expect(computeResolvesAt('fx', '3m', anchor)).toBe(new Date(base + 90 * 86_400_000).toISOString())
  })
})

describe('cacheBucketFor', () => {
  const now = new Date('2026-08-24T09:00:00.000Z') // a Monday

  it('1d buckets by UTC day — a new round opens once per day', () => {
    expect(cacheBucketFor('1d', now)).toBe('2026-08-24')
  })

  it('1w buckets by ISO week start (Monday) — a new round opens once per week', () => {
    expect(cacheBucketFor('1w', now)).toBe('2026-08-24')
    const midWeek = new Date('2026-08-27T09:00:00.000Z')
    expect(cacheBucketFor('1w', midWeek)).toBe('2026-08-24')
  })

  it('1m buckets by UTC calendar month — a new round opens once per month', () => {
    expect(cacheBucketFor('1m', now)).toBe('2026-08')
    expect(cacheBucketFor('1m', new Date('2026-08-01T00:00:00.000Z'))).toBe('2026-08')
    expect(cacheBucketFor('1m', new Date('2026-09-01T00:00:00.000Z'))).toBe('2026-09')
  })

  it('3m buckets by UTC calendar quarter — a new round opens once per quarter', () => {
    expect(cacheBucketFor('3m', now)).toBe('2026-Q3')
    expect(cacheBucketFor('3m', new Date('2026-01-15T00:00:00.000Z'))).toBe('2026-Q1')
    expect(cacheBucketFor('3m', new Date('2026-12-31T00:00:00.000Z'))).toBe('2026-Q4')
  })

  it('a long-horizon bucket does not roll over mid-period, so no overlapping round opens while one is pending', () => {
    const opened = new Date('2026-08-05T00:00:00.000Z')
    const stillWithinMonth = new Date('2026-08-30T00:00:00.000Z')
    expect(cacheBucketFor('1m', opened)).toBe(cacheBucketFor('1m', stillWithinMonth))
  })
})

describe('tradingApproximationNote', () => {
  it('is null for 1d — an off-by-one-holiday deadline shift is immaterial to a next-session round', () => {
    expect(tradingApproximationNote('stock', '1d')).toBeNull()
    expect(tradingApproximationNote('etf_index', '1d')).toBeNull()
  })

  it('is null for calendar-day categories at every horizon — no approximation is made there', () => {
    for (const h of UI_HORIZONS) {
      expect(tradingApproximationNote('crypto_spot', h)).toBeNull()
      expect(tradingApproximationNote('fx', h)).toBeNull()
    }
  })

  it('discloses the weekday-count approximation for equities/ETF at 1w/1m/3m', () => {
    for (const h of ['1w', '1m', '3m'] as const) {
      expect(tradingApproximationNote('stock', h)).toMatch(/weekday/)
      expect(tradingApproximationNote('etf_index', h)).toMatch(/holiday calendar/)
    }
  })
})
