import type { PredictionCategory } from '@/lib/prediction/categories'
import { isKrStockInstrument } from '@/lib/league/korea-equity-catalog'
import {
  krxSessionCloseIso,
  lastCompletedKrxSession,
  nthFutureKrxSessionDate,
} from '@/lib/league/krx-calendar'
import { isUsEquityTradingDay, US_EQUITY_CALENDAR_VALID_THROUGH } from '@/lib/league/us-equity-calendar'

/**
 * AI Prediction League — HORIZON SELECTION (pure).
 *
 * `prediction_rounds.horizon` has existed as a free-text column since the
 * original ledger migration (20260813000001_prediction_ledger.sql) — "kept as
 * free text so new horizons need no migration."
 *
 * ONE VOCABULARY, END TO END: the 4 codes below (`1d` / `1w` / `1m` / `3m`)
 * are BOTH the UI-facing option AND the exact string stored on the round.
 * There is no UI-vs-DB translation table — the value the user selects is the
 * value written to `prediction_rounds.horizon` and the value read back on the
 * card. (The single legacy `24h` row that predated this was backfilled to
 * `1d`; the CHECK constraint in 20260824000001 pins the column to these 4.)
 *
 * This module is the single place that:
 *  1. defines/validates the 4 canonical horizon codes;
 *  2. computes `resolves_at` from an anchor timestamp, honoring the rule
 *     "trading sessions for equities / index ETFs / REIT ETFs / US-listed
 *     metal ETFs (GLD, SLV), calendar days for crypto / FX / spot metals
 *     (XAU/USD) / energy";
 *  3. buckets the idempotency cache key at a granularity matching the
 *     horizon's own cadence, so a 1-month round opens once a month, not
 *     once a day — see `cacheBucketFor`.
 *
 * EACH HORIZON IS A SEPARATE ROUND. Nothing here ever mutates or
 * reinterprets an existing round's `resolves_at`; a new bucket simply makes
 * a NEW round eligible to be opened once the previous one's period has
 * passed (see `lib/league/catalog.ts` / `lib/league/public-access.ts`).
 */

export const UI_HORIZONS = ['1d', '1w', '1m', '3m'] as const
export type UiHorizon = (typeof UI_HORIZONS)[number]

export function isUiHorizon(value: unknown): value is UiHorizon {
  return typeof value === 'string' && (UI_HORIZONS as readonly string[]).includes(value)
}

/**
 * "Trading sessions for equities / index ETFs / REIT ETFs / US-listed
 * metal ETFs, calendar days for crypto / FX / spot metals / energy."
 *
 * Clock follows LISTING, not catalog chip. gold_metal chips mix both:
 * XAU/USD is a 24/5 spot pair (calendar days); GLD and SLV are NYSE
 * equities and share the equity session clock even though they are filed
 * under gold_metals (underlying asset), not index_etf.
 *
 * commodity_energy mixes clocks: WTI/USD and XBR/USD are spots (calendar);
 * UNG/CPER/CORN/WEAT/SOYB/COFF are listed ETFs and use the session clock.
 * REIT ETFs (VNQ, SCHH) live on etf_index. real_estate is a published
 * house-price index and resolves on its publication date, not a session close.
 */
const TRADING_SESSION_CATEGORIES: ReadonlySet<PredictionCategory> = new Set([
  'stock',
  'etf_index',
])

/**
 * US-listed equity tickers whose ledger category is NOT stock/etf_index
 * but whose grading close is the NYSE/Nasdaq session. Catalog files them
 * by underlying asset (GLD/SLV → gold_metal; UNG/CPER/grains/COFF → commodity_energy).
 */
export const SESSION_CLOCK_INSTRUMENTS: ReadonlySet<string> = new Set([
  'GLD',
  'SLV',
  'UNG',
  'CPER',
  'CORN',
  'WEAT',
  'SOYB',
  'COFF',
])

export function usesTradingSessions(
  category: PredictionCategory | string,
  instrument?: string | null,
): boolean {
  if (TRADING_SESSION_CATEGORIES.has(category as PredictionCategory)) return true
  const ticker = instrument?.trim().toUpperCase()
  return Boolean(ticker && SESSION_CLOCK_INSTRUMENTS.has(ticker))
}

/**
 * Trading-session count per horizon (Mon–Fri weekday count; no exchange
 * holiday calendar is wired up, so this is a weekday approximation — the
 * same approximation documented on `addTradingDays` below).
 */
export const TRADING_SESSION_COUNT: Record<UiHorizon, number> = {
  '1d': 1,
  '1w': 5,
  '1m': 21,
  '3m': 63,
}

/** Calendar-day count per horizon for categories that trade every day. */
export const CALENDAR_DAY_COUNT: Record<UiHorizon, number> = {
  '1d': 1,
  '1w': 7,
  '1m': 30,
  '3m': 90,
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Buffer after the target session's exchange close.
 *
 * Grading (`lib/prediction/resolution.ts`, 2026-08-21 contract — do not change)
 * treats a daily bar dated D as closing at `D T23:59:59.999Z`, not at the
 * exchange bell. NYSE 16:00 ET is 20:00 UTC (EDT) or 21:00 UTC (EST); a
 * one-hour-after-bell deadline would still exclude D's bar. Pinning
 * `resolves_at` to the UTC end of D is the smallest buffer that:
 *   - is after the 16:00 ET close (by ~4h EDT / ~3h EST);
 *   - includes the graded bar (`closeMs <= resolves_at`);
 *   - excludes the next UTC day's bar.
 */
export const EQUITY_SESSION_RESOLVES_AT_SUFFIX = 'T23:59:59.999Z'

/**
 * How many daily bars ahead the base rate / `resolves_at` counts for this
 * (category, horizon). Equities/ETFs: trading sessions. Crypto/FX: calendar
 * days (those series include weekend bars). Unknown horizon → 1 (1d).
 */
export function sessionsForHorizon(
  category: PredictionCategory | string,
  horizon: string,
  instrument?: string | null,
): number {
  const h = isUiHorizon(horizon) ? horizon : '1d'
  if (usesTradingSessions(category, instrument) || usesWeekdayDailyBars(category, instrument)) {
    return TRADING_SESSION_COUNT[h]
  }
  return CALENDAR_DAY_COUNT[h]
}

const COMPLETED_DAILY_BAR_CATEGORIES: ReadonlySet<string> = new Set([
  'gold_metal',
  'fx',
  'crypto_spot',
  'memecoin',
  'commodity_energy',
  'crypto_perps',
])

const WEEKDAY_DAILY_BAR_CATEGORIES: ReadonlySet<string> = new Set(['gold_metal', 'fx', 'commodity_energy'])

/**
 * 24h spots (XAU, EUR/USD, BTC, DOGE, WTI…). Not NYSE-session ETFs, not KRSTOCK.
 * These grade on completed UTC daily bars, not a live quote vs the same day's bar.
 */
export function usesCompletedDailyBars(
  category: PredictionCategory | string,
  instrument?: string | null,
): boolean {
  if (usesTradingSessions(category, instrument)) return false
  return COMPLETED_DAILY_BAR_CATEGORIES.has(category)
}

/** FX / spot metals / energy spots: Mon–Fri UTC bars. Crypto / memecoin: every civil day. */
export function usesWeekdayDailyBars(
  category: PredictionCategory | string,
  instrument?: string | null,
): boolean {
  return usesCompletedDailyBars(category, instrument) && WEEKDAY_DAILY_BAR_CATEGORIES.has(category)
}

export function dailyBarCloseIso(ymd: string): string {
  return `${ymd}${EQUITY_SESSION_RESOLVES_AT_SUFFIX}`
}

function utcYmdFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function shiftUtcYmd(ymd: string, days: number): string {
  return utcYmdFromMs(Date.parse(`${ymd}T00:00:00.000Z`) + days * DAY_MS)
}

function isUtcWeekday(ymd: string): boolean {
  const day = new Date(`${ymd}T12:00:00.000Z`).getUTCDay()
  return day !== 0 && day !== 6
}

function isEligibleDailyBar(ymd: string, weekdayOnly: boolean): boolean {
  return weekdayOnly ? isUtcWeekday(ymd) : true
}

/**
 * Most recent completed UTC daily bar before `openIso`. A bar dated D completes
 * at `D T23:59:59.999Z`. Weekday-only skips Sat/Sun.
 */
export function lastCompletedDailyBarDate(openIso: string, weekdayOnly: boolean): string {
  const openMs = Date.parse(openIso)
  let ymd = utcYmdFromMs(openMs)
  for (let i = 0; i < 21; i++) {
    if (isEligibleDailyBar(ymd, weekdayOnly) && Date.parse(dailyBarCloseIso(ymd)) < openMs) {
      return ymd
    }
    ymd = shiftUtcYmd(ymd, -1)
  }
  throw new Error(`lastCompletedDailyBarDate: no completed bar before ${openIso}`)
}

/** Nth completed daily bar strictly after `anchorBarDate`. */
export function nthFutureDailyBarDate(anchorBarDate: string, n: number, weekdayOnly: boolean): string {
  let ymd = shiftUtcYmd(anchorBarDate, 1)
  let counted = 0
  for (let i = 0; i < n * 3 + 21; i++) {
    if (isEligibleDailyBar(ymd, weekdayOnly)) {
      counted += 1
      if (counted === n) return ymd
    }
    ymd = shiftUtcYmd(ymd, 1)
  }
  throw new Error(`nthFutureDailyBarDate: could not find bar ${n} after ${anchorBarDate}`)
}

export function pickCompletedDailyClose(
  series: readonly { date: string; close: number }[],
  openIso: string,
  weekdayOnly: boolean,
): { close: number; sessionDate: string } | null {
  let want: string
  try {
    want = lastCompletedDailyBarDate(openIso, weekdayOnly)
  } catch {
    return null
  }
  for (let i = series.length - 1; i >= 0; i--) {
    const date = series[i]!.date.trim().slice(0, 10)
    if (date === want && Number.isFinite(series[i]!.close) && series[i]!.close > 0) {
      return { close: series[i]!.close, sessionDate: date }
    }
  }
  return null
}

/**
 * Public catalog equities/ETFs are NYSE/Nasdaq. Session-counted categories
 * and SESSION_CLOCK_INSTRUMENTS (GLD, SLV) use this exchange clock.
 * (KRX symbols exist in `open-phase.ts` but are not in the public catalog.)
 */
const US_EQUITY_TIME_ZONE = 'America/New_York'
const US_EQUITY_CLOSE_HOUR = 16
const US_EQUITY_CLOSE_MINUTE = 0

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function zonedYmd(at: Date, timeZone: string): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  )
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) }
}

/** Offset of `timeZone` at `instant`: local_as_UTC − instant. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(instant).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  )
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  )
  return asUtc - instant.getTime()
}

/** Instant at which `timeZone` wall-clock equals the given civil date + time. */
function utcMsFromZonedLocal(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  const instant = utcGuess - tzOffsetMs(new Date(utcGuess), timeZone)
  return utcGuess - tzOffsetMs(new Date(instant), timeZone)
}

function addCivilDays(year: number, month: number, day: number, n: number): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + n))
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() }
}

/**
 * YYYY-MM-DD of the Nth US-equity session whose 16:00 ET close is strictly
 * after `anchorIso`. Weekends and NYSE full-day holidays are skipped.
 * Throws `us_calendar_unverified` past the published holiday list.
 */
export function nthFutureUsEquitySessionDate(anchorIso: string, n: number): string {
  const anchorMs = Date.parse(anchorIso)
  let { year, month, day } = zonedYmd(new Date(anchorMs), US_EQUITY_TIME_ZONE)
  let counted = 0
  const maxSteps = n * 3 + 21
  for (let i = 0; i < maxSteps; i++) {
    const ymd = `${year}-${pad2(month)}-${pad2(day)}`
    if (ymd > US_EQUITY_CALENDAR_VALID_THROUGH) {
      throw new Error('us_calendar_unverified')
    }
    if (isUsEquityTradingDay(ymd)) {
      const closeMs = utcMsFromZonedLocal(
        US_EQUITY_TIME_ZONE,
        year,
        month,
        day,
        US_EQUITY_CLOSE_HOUR,
        US_EQUITY_CLOSE_MINUTE
      )
      if (closeMs > anchorMs) {
        counted += 1
        if (counted === n) return `${year}-${pad2(month)}-${pad2(day)}`
      }
    }
    ;({ year, month, day } = addCivilDays(year, month, day, 1))
  }
  throw new Error(`nthFutureUsEquitySessionDate: could not find session ${n} after ${anchorIso}`)
}

/**
 * Adds `n` WEEKDAYS (Mon–Fri) to a timestamp, landing on a weekday at the
 * SAME CLOCK TIME. Kept as a weekday helper (and for legacy-deadline
 * comparisons in tests). `computeResolvesAt` for equities no longer uses
 * this — same-clock landing is what made deadlines miss the grading close.
 *
 * APPROXIMATION, documented: this skips weekends only. There is no exchange
 * holiday calendar wired into this codebase (no holiday-calendar API is
 * called anywhere in `lib/league`), so a US market holiday inside the window
 * is not skipped. Grading itself never assumes a session existed —
 * `resolveRoundOutcome` in `lib/prediction/resolution.ts` picks whatever
 * daily bar actually closed inside the window, or refuses with
 * `no_session_in_window` — so an occasional holiday inside the window makes
 * grading pick the next real session, never a wrong one.
 */
export function addTradingDays(fromMs: number, n: number): number {
  let ms = fromMs
  let remaining = n
  while (remaining > 0) {
    ms += DAY_MS
    const day = new Date(ms).getUTCDay() // 0 = Sunday, 6 = Saturday
    if (day !== 0 && day !== 6) remaining -= 1
  }
  return ms
}

export type ComputeResolvesAtResult =
  | { ok: true; resolvesAt: string }
  | { ok: false; reason: 'krx_calendar_unverified' | 'us_calendar_unverified' }

/**
 * `resolves_at` for a NEW round, from its anchor observation time.
 *
 *  - KRSTOCK: Nth future KRX session after `lastCompletedKrxSession(anchor)`,
 *    pinned to that day's 15:30 KST close. Refuses with
 *    `krx_calendar_unverified` past the published holiday calendar — never
 *    throws, never guesses 2027+.
 *  - equities/ETF (`usesTradingSessions`): Nth future US exchange session
 *    (Mon–Fri whose 16:00 ET close is strictly after the anchor), with
 *    `resolves_at` pinned past that session's close — see
 *    `EQUITY_SESSION_RESOLVES_AT_SUFFIX`. Does NOT keep the anchor's clock
 *    time (that is what made a Saturday 09:43 UTC open due Monday 09:43 UTC,
 *    before Monday's graded close at 23:59:59.999Z).
 *  - 24h spots (FX / metals / energy / crypto / memecoin): last completed
 *    UTC daily bar before the open, then the Nth completed bar after that
 *    (weekdays for FX/metals/energy; every civil day for crypto/memecoin).
 *    `resolves_at` is that bar's UTC close (`T23:59:59.999Z`).
 *  - everything else (e.g. house-price indexes): anchor + N calendar days,
 *    SAME clock time.
 *
 * Session counts (US and KRSTOCK share `TRADING_SESSION_COUNT`):
 *   1d = 1, 1w = 5, 1m = 21, 3m = 63.
 */
export function computeResolvesAt(
  category: PredictionCategory | string,
  horizon: UiHorizon,
  anchorIso: string,
  instrument?: string | null,
): ComputeResolvesAtResult {
  if (instrument && isKrStockInstrument(instrument)) {
    const last = lastCompletedKrxSession(new Date(anchorIso))
    if (!last.ok) return last
    const future = nthFutureKrxSessionDate(last.date, TRADING_SESSION_COUNT[horizon])
    if (!future.ok) return future
    return { ok: true, resolvesAt: krxSessionCloseIso(future.date) }
  }
  const anchorMs = Date.parse(anchorIso)
  if (usesCompletedDailyBars(category, instrument)) {
    const weekdayOnly = usesWeekdayDailyBars(category, instrument)
    const last = lastCompletedDailyBarDate(anchorIso, weekdayOnly)
    const future = nthFutureDailyBarDate(last, sessionsForHorizon(category, horizon, instrument), weekdayOnly)
    return { ok: true, resolvesAt: dailyBarCloseIso(future) }
  }
  if (!usesTradingSessions(category, instrument)) {
    return { ok: true, resolvesAt: new Date(anchorMs + CALENDAR_DAY_COUNT[horizon] * DAY_MS).toISOString() }
  }
  try {
    const sessionDate = nthFutureUsEquitySessionDate(anchorIso, TRADING_SESSION_COUNT[horizon])
    return { ok: true, resolvesAt: `${sessionDate}${EQUITY_SESSION_RESOLVES_AT_SUFFIX}` }
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'us_calendar_unverified') {
      return { ok: false, reason: 'us_calendar_unverified' }
    }
    throw e
  }
}

/**
 * NYSE holidays are now on the session clock (see `us-equity-calendar.ts`),
 * so the old weekday-approximation sentence is no longer appended.
 * Kept as a function so catalog call sites stay stable; always null.
 */
export function tradingApproximationNote(
  _category: PredictionCategory | string,
  _horizon: UiHorizon,
  _instrument?: string | null,
): string | null {
  return null
}

function isoWeekStart(date: Date): string {
  // ISO week starts Monday. getUTCDay(): 0=Sun..6=Sat: Monday offset = (day+6)%7.
  const day = date.getUTCDay()
  const offset = (day + 6) % 7
  const monday = new Date(date.getTime() - offset * DAY_MS)
  return monday.toISOString().slice(0, 10)
}

/**
 * Idempotency bucket for the cache key, at a granularity matching the
 * horizon's own cadence: a 1-day round opens once per UTC day, a 1-week
 * round once per ISO week, a 1-month round once per UTC calendar month, a
 * 3-month round once per UTC calendar quarter. This is what makes "today's
 * round for this (instrument, horizon)" mean "the currently-open round for
 * that horizon" rather than spawning a new overlapping round every day while
 * a long-horizon round is still pending — see the module doc comment.
 */
export function cacheBucketFor(horizon: UiHorizon, now: Date): string {
  if (horizon === '1d') return now.toISOString().slice(0, 10)
  if (horizon === '1w') return isoWeekStart(now)
  const year = now.getUTCFullYear()
  if (horizon === '1m') return `${year}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1
  return `${year}-Q${quarter}`
}
