import { fromZonedTime } from 'date-fns-tz'
import { describe, expect, it } from 'vitest'
import { selectResolutionSession, type DailyBar } from '../../prediction/resolution'
import { resolveOpenPhase, type OpenPhase } from '../open-phase'
import {
  addTradingDays,
  cacheBucketFor,
  computeResolvesAt,
  EQUITY_SESSION_RESOLVES_AT_SUFFIX,
  isUiHorizon,
  nthFutureUsEquitySessionDate,
  TRADING_SESSION_COUNT,
  tradingApproximationNote,
  UI_HORIZONS,
  usesTradingSessions,
  type UiHorizon,
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

  it('crypto/FX keep the anchor clock time even on a weekend morning UTC open (the equity failure case)', () => {
    const weekendMorning = '2026-08-29T09:43:16.752Z'
    expect(computeResolvesAt('crypto_spot', '1d', weekendMorning)).toBe('2026-08-30T09:43:16.752Z')
    expect(computeResolvesAt('fx', '1d', weekendMorning)).toBe('2026-08-30T09:43:16.752Z')
    expect(computeResolvesAt('crypto_spot', '1w', weekendMorning)).toBe('2026-09-05T09:43:16.752Z')
    expect(computeResolvesAt('fx', '1m', weekendMorning)).toBe('2026-09-28T09:43:16.752Z')
    expect(computeResolvesAt('crypto_spot', '3m', weekendMorning)).toBe('2026-11-27T09:43:16.752Z')
  })

  it('etf_index matches stock (same session-counted path)', () => {
    const weekendMorning = '2026-08-29T09:43:16.752Z'
    for (const h of UI_HORIZONS) {
      expect(computeResolvesAt('etf_index', h, weekendMorning)).toBe(computeResolvesAt('stock', h, weekendMorning))
    }
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

const DAY_MS = 86_400_000

/** Same formula as `sessionCloseMs` in resolution.ts (copied; that file is not to change). */
function gradingCloseMs(sessionDate: string): number {
  return Date.parse(`${sessionDate}T23:59:59.999Z`)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function ymdUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Weekday UTC-dated bars covering [fromYmd, toYmd]. */
function weekdayBars(fromYmd: string, toYmd: string): DailyBar[] {
  const bars: DailyBar[] = []
  let ms = Date.parse(`${fromYmd}T12:00:00.000Z`)
  const end = Date.parse(`${toYmd}T12:00:00.000Z`)
  while (ms <= end) {
    const day = new Date(ms).getUTCDay()
    if (day !== 0 && day !== 6) {
      bars.push({ sessionDate: ymdUtc(ms), close: 100 + bars.length })
    }
    ms += DAY_MS
  }
  return bars
}

function barsAroundAnchor(anchorIso: string): DailyBar[] {
  const anchorMs = Date.parse(anchorIso)
  return weekdayBars(ymdUtc(anchorMs - 21 * DAY_MS), ymdUtc(anchorMs + 120 * DAY_MS))
}

/**
 * Independent of `horizon.ts`: count N Mon–Fri civil dates whose 16:00
 * America/New_York close (via date-fns-tz) is strictly after the anchor.
 */
function independentNthUsSessionDate(anchorIso: string, n: number): string {
  const anchorMs = Date.parse(anchorIso)
  const start = new Date(
    Date.UTC(new Date(anchorMs).getUTCFullYear(), new Date(anchorMs).getUTCMonth(), new Date(anchorMs).getUTCDate() - 1)
  )
  let counted = 0
  for (let i = 0; i < n * 3 + 21; i++) {
    const ymd = `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-${pad2(start.getUTCDate())}`
    const weekday = start.getUTCDay()
    const closeMs = fromZonedTime(`${ymd}T16:00:00`, 'America/New_York').getTime()
    if (weekday !== 0 && weekday !== 6 && closeMs > anchorMs) {
      counted += 1
      if (counted === n) return ymd
    }
    start.setUTCDate(start.getUTCDate() + 1)
  }
  throw new Error(`independentNthUsSessionDate: could not find session ${n} after ${anchorIso}`)
}

function inGradingWindow(sessionDate: string, anchorMs: number, resolvesMs: number): boolean {
  const closeMs = gradingCloseMs(sessionDate)
  return closeMs > anchorMs && closeMs <= resolvesMs
}

function nextUtcWeekday(ymd: string): string {
  let ms = Date.parse(`${ymd}T12:00:00.000Z`) + DAY_MS
  while (true) {
    const day = new Date(ms).getUTCDay()
    if (day !== 0 && day !== 6) return ymdUtc(ms)
    ms += DAY_MS
  }
}

function legacySameClockResolvesAt(horizon: UiHorizon, anchorIso: string): string {
  return new Date(addTradingDays(Date.parse(anchorIso), TRADING_SESSION_COUNT[horizon])).toISOString()
}

/** Fixtures from open-phase.test.ts (EDT August 2026). */
const PHASE_FIXTURES: { phase: OpenPhase; anchorIso: string }[] = [
  { phase: 'weekend', anchorIso: '2026-08-22T15:00:00.000Z' },
  { phase: 'pre_open', anchorIso: '2026-08-24T12:00:00.000Z' },
  { phase: 'intraday', anchorIso: '2026-08-24T15:00:00.000Z' },
  { phase: 'after_close', anchorIso: '2026-08-24T21:00:00.000Z' },
]

describe('computeResolvesAt — session-counted equities pin past the target close', () => {
  it('tags the four fixtures as the intended open phases', () => {
    for (const row of PHASE_FIXTURES) {
      expect(resolveOpenPhase('AAPL', new Date(row.anchorIso))).toBe(row.phase)
    }
  })

  it('for each 1d/1w/1m/3m × pre_open/intraday/after_close/weekend, a session close falls in (anchor, resolves_at]', () => {
    const lines: string[] = [
      'horizon  phase         anchor                      resolves_at                 last_session  n_in_window',
    ]
    for (const horizon of UI_HORIZONS) {
      const n = TRADING_SESSION_COUNT[horizon]
      for (const { phase, anchorIso } of PHASE_FIXTURES) {
        const resolvesAt = computeResolvesAt('stock', horizon, anchorIso)
        const expectedDate = independentNthUsSessionDate(anchorIso, n)
        expect(nthFutureUsEquitySessionDate(anchorIso, n)).toBe(expectedDate)
        expect(resolvesAt).toBe(`${expectedDate}${EQUITY_SESSION_RESOLVES_AT_SUFFIX}`)

        const anchorMs = Date.parse(anchorIso)
        const resolvesMs = Date.parse(resolvesAt)
        const bars = barsAroundAnchor(anchorIso)
        const selected = selectResolutionSession(bars, anchorMs, resolvesMs)
        expect(selected, `${horizon} ${phase} ${anchorIso} → ${resolvesAt}`).not.toBeNull()
        expect(inGradingWindow(selected!.sessionDate, anchorMs, resolvesMs)).toBe(true)
        expect(selected!.sessionDate).toBe(expectedDate)

        const inWindow = bars.filter((b) => inGradingWindow(b.sessionDate, anchorMs, resolvesMs))
        expect(inWindow.length).toBeGreaterThanOrEqual(n)
        expect(inWindow[inWindow.length - 1]?.sessionDate).toBe(expectedDate)
        expect(inGradingWindow(nextUtcWeekday(expectedDate), anchorMs, resolvesMs)).toBe(false)

        lines.push(
          `${horizon.padEnd(8)} ${phase.padEnd(13)} ${anchorIso}  ${resolvesAt}  ${expectedDate}      ${inWindow.length}`
        )
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n=== equity computeResolvesAt matrix (session close must fall in window) ===\n' + lines.join('\n') + '\n')
  })

  it("round 65192045 clock (Sat 2026-08-29 09:43 UTC, 1d) now includes Monday's graded close", () => {
    const anchorIso = '2026-08-29T09:43:16.752Z'
    const resolvesAt = computeResolvesAt('stock', '1d', anchorIso)
    expect(resolvesAt).toBe('2026-08-31T23:59:59.999Z')

    const anchorMs = Date.parse(anchorIso)
    const resolvesMs = Date.parse(resolvesAt)
    expect(inGradingWindow('2026-08-28', anchorMs, resolvesMs)).toBe(false)
    expect(inGradingWindow('2026-08-31', anchorMs, resolvesMs)).toBe(true)

    const selected = selectResolutionSession(
      [
        { sessionDate: '2026-08-28', close: 319.70001 },
        { sessionDate: '2026-08-31', close: 320 },
      ],
      anchorMs,
      resolvesMs
    )
    expect(selected?.sessionDate).toBe('2026-08-31')
  })
})

describe('legacy same-clock deadline — fraction of open times in the broken window', () => {
  function sampleEvery15Min(fromIso: string, toIsoExclusive: string): string[] {
    const out: string[] = []
    for (let ms = Date.parse(fromIso); ms < Date.parse(toIsoExclusive); ms += 15 * 60 * 1000) {
      out.push(new Date(ms).toISOString())
    }
    return out
  }

  function classify(horizon: UiHorizon, samples: string[]) {
    let empty = 0
    let wrongSession = 0
    let ok = 0
    for (const anchorIso of samples) {
      const n = TRADING_SESSION_COUNT[horizon]
      const intended = independentNthUsSessionDate(anchorIso, n)
      const bars = barsAroundAnchor(anchorIso)
      const oldResolves = legacySameClockResolvesAt(horizon, anchorIso)
      const selected = selectResolutionSession(bars, Date.parse(anchorIso), Date.parse(oldResolves))
      if (!selected) empty += 1
      else if (selected.sessionDate !== intended) wrongSession += 1
      else ok += 1
    }
    return {
      total: samples.length,
      empty,
      wrongSession,
      ok,
      brokenEmptyPct: (100 * empty) / samples.length,
      wrongPct: (100 * wrongSession) / samples.length,
    }
  }

  it("reports today's (Mon 2026-08-31) fraction and a week that includes the Sat 09:43 failure class", () => {
    const today = sampleEvery15Min('2026-08-31T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
    const week = sampleEvery15Min('2026-08-29T00:00:00.000Z', '2026-09-05T00:00:00.000Z')
    const rows: string[] = [
      'window                         horizon  samples  empty(no_session)  wrong_session  ok     empty%   wrong%',
    ]
    const summary: Record<string, ReturnType<typeof classify>> = {}
    for (const [label, samples] of [
      ['today Mon 2026-08-31 UTC', today],
      ['week Sat 08-29–Fri 09-04 UTC', week],
    ] as const) {
      for (const horizon of UI_HORIZONS) {
        const c = classify(horizon, samples)
        summary[`${label}|${horizon}`] = c
        rows.push(
          `${label.padEnd(30)} ${horizon.padEnd(8)} ${String(c.total).padStart(7)}  ${String(c.empty).padStart(16)}  ${String(c.wrongSession).padStart(13)}  ${String(c.ok).padStart(6)}  ${c.brokenEmptyPct.toFixed(1).padStart(6)}%  ${c.wrongPct.toFixed(1).padStart(5)}%`
        )
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n=== legacy same-clock broken-window fractions ===\n' + rows.join('\n') + '\n')

    // The 65192045 class: weekend 1d is empty under the old deadline.
    const sat0943 = classify('1d', ['2026-08-29T09:43:16.752Z'])
    expect(sat0943.empty).toBe(1)

    expect(today).toHaveLength(96)
    expect(week).toHaveLength(7 * 96)

    // Today is Monday: no weekend empty-window class. The 16.7% is after_close
    // (20:00–23:45 UTC = 16 of 96 slots) grading today's already-known close.
    expect(summary['today Mon 2026-08-31 UTC|1d']).toMatchObject({ empty: 0, wrongSession: 16, ok: 80 })
    expect(summary['today Mon 2026-08-31 UTC|1w']).toMatchObject({ empty: 0, wrongSession: 16, ok: 80 })
    expect(summary['today Mon 2026-08-31 UTC|1m']).toMatchObject({ empty: 0, wrongSession: 16, ok: 80 })
    expect(summary['today Mon 2026-08-31 UTC|3m']).toMatchObject({ empty: 0, wrongSession: 16, ok: 80 })

    // Week including Sat 08-29: 1d empty = both weekend days (192/672 = 2/7).
    // Longer horizons are never empty but miss the intended last session on
    // weekend + after_close (192+80=272).
    expect(summary['week Sat 08-29–Fri 09-04 UTC|1d']).toMatchObject({ empty: 192, wrongSession: 80, ok: 400 })
    expect(summary['week Sat 08-29–Fri 09-04 UTC|1w']).toMatchObject({ empty: 0, wrongSession: 272, ok: 400 })
    expect(summary['week Sat 08-29–Fri 09-04 UTC|1m']).toMatchObject({ empty: 0, wrongSession: 272, ok: 400 })
    expect(summary['week Sat 08-29–Fri 09-04 UTC|3m']).toMatchObject({ empty: 0, wrongSession: 272, ok: 400 })
  })
})
