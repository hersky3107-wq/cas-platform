/**
 * KRX (Korea Exchange) trading-day calendar. Pure — no network.
 *
 * 2026-06-03 (local election) and 2026-07-17 (제헌절) confirmed closed (KRX
 * returned no data). 2026 from 2026-08-17 is from the KRX holiday notice.
 * 2027 is provisional (government 월력요항, published 2026-06-29) until the
 * KRX annual notice (usually December) is reconciled.
 */

export const KRX_TIME_ZONE = 'Asia/Seoul'
export const KRX_OPEN_HOUR = 9
export const KRX_OPEN_MINUTE = 0
export const KRX_CLOSE_HOUR = 15
export const KRX_CLOSE_MINUTE = 30

/** First date whose holidays are provisional (government 월력요항, not KRX). */
export const KRX_PROVISIONAL_FROM = '2027-01-01'
export const KRX_CALENDAR_VALID_THROUGH = '2027-12-31'

/**
 * KST dates "YYYY-MM-DD". 2026-06-03 and 2026-07-17 confirmed closed by KRX
 * (no data). Remaining 2026 dates from the KRX holiday notice. 2027 weekday
 * closures are provisional (월력요항, published 2026-06-29).
 */
export const KRX_HOLIDAYS: ReadonlySet<string> = new Set([
  '2026-06-03',
  '2026-07-17',
  '2026-08-17',
  '2026-09-24',
  '2026-09-25',
  '2026-10-05',
  '2026-10-09',
  '2026-12-25',
  '2026-12-31',
  // Provisional 2027 (weekday closures only). Reconcile when KRX publishes.
  '2027-01-01',
  '2027-02-08',
  '2027-02-09',
  '2027-03-01',
  '2027-05-03',
  '2027-05-05',
  '2027-05-13',
  '2027-07-19',
  '2027-08-16',
  '2027-09-14',
  '2027-09-15',
  '2027-09-16',
  '2027-10-04',
  '2027-10-11',
  '2027-12-27',
  '2027-12-31',
])

/**
 * Late-open session dates from the KRX notice, e.g. `{ "YYYY-MM-DD": "10:00" }`.
 * Dates must come from the KRX notice; do not fill it.
 */
export const KRX_LATE_OPEN: Readonly<Record<string, string>> = {}

export type KrxCalendarOk = { ok: true; date: string }
export type KrxCalendarUnverified = { ok: false; reason: 'krx_calendar_unverified' }
export type KrxCalendarResult = KrxCalendarOk | KrxCalendarUnverified

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function parseYmd(ymd: string): { year: number; month: number; day: number } {
  const [ys, ms, ds] = ymd.split('-')
  return { year: Number(ys), month: Number(ms), day: Number(ds) }
}

function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function addCivilDays(ymd: string, n: number): string {
  const { year, month, day } = parseYmd(ymd)
  const utc = new Date(Date.UTC(year, month - 1, day + n))
  return formatYmd(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate())
}

function weekdayUtcYmd(ymd: string): number {
  const { year, month, day } = parseYmd(ymd)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
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
    fmt.formatToParts(instant).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - instant.getTime()
}

function utcMsFromZonedLocal(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  const instant = utcGuess - tzOffsetMs(new Date(utcGuess), timeZone)
  return utcGuess - tzOffsetMs(new Date(instant), timeZone)
}

export function kstCivilDate(at: Date): string {
  return kstClock(at).date
}

/** KST civil date and clock. Hour 24 from some Intl builds is normalized to 0. */
export function kstClock(at: Date): { date: string; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: KRX_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  )
  let hour = Number(parts.hour)
  if (hour === 24) hour = 0
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute: Number(parts.minute),
  }
}

export function krxSessionCloseMs(ymd: string): number {
  const { year, month, day } = parseYmd(ymd)
  return utcMsFromZonedLocal(KRX_TIME_ZONE, year, month, day, KRX_CLOSE_HOUR, KRX_CLOSE_MINUTE)
}

/** Instant of the regular-session close (15:30 KST) as ISO-8601 UTC. */
export function krxSessionCloseIso(ymd: string): string {
  return new Date(krxSessionCloseMs(ymd)).toISOString()
}

export function isKrxTradingDay(kstDate: string): boolean {
  const weekday = weekdayUtcYmd(kstDate)
  if (weekday === 0 || weekday === 6) return false
  return !KRX_HOLIDAYS.has(kstDate)
}

/**
 * 2027 is provisional until the KRX annual notice (December 2026); 12-31
 * year-end closure assumed by convention.
 */
export function isProvisionalKrxDate(date: string): boolean {
  return date >= KRX_PROVISIONAL_FROM && date <= KRX_CALENDAR_VALID_THROUGH
}

/**
 * Most recent KST trading date whose 15:30 close is <= `now`.
 * Does not guess dates after `KRX_CALENDAR_VALID_THROUGH`.
 */
export function lastCompletedKrxSession(now: Date): KrxCalendarResult {
  const kst = kstCivilDate(now)
  if (kst > KRX_CALENDAR_VALID_THROUGH) {
    return { ok: false, reason: 'krx_calendar_unverified' }
  }
  let cursor = kst
  for (let i = 0; i < 370; i++) {
    if (isKrxTradingDay(cursor) && krxSessionCloseMs(cursor) <= now.getTime()) {
      return { ok: true, date: cursor }
    }
    cursor = addCivilDays(cursor, -1)
  }
  return { ok: false, reason: 'krx_calendar_unverified' }
}

/** The n-th KRX trading day after `fromSessionDate`. */
export function nthFutureKrxSessionDate(fromSessionDate: string, n: number): KrxCalendarResult {
  let cursor = fromSessionDate
  let counted = 0
  const maxSteps = Math.max(n, 1) * 4 + 21
  for (let i = 0; i < maxSteps; i++) {
    cursor = addCivilDays(cursor, 1)
    if (cursor > KRX_CALENDAR_VALID_THROUGH) {
      return { ok: false, reason: 'krx_calendar_unverified' }
    }
    if (isKrxTradingDay(cursor)) {
      counted += 1
      if (counted === n) return { ok: true, date: cursor }
    }
  }
  return { ok: false, reason: 'krx_calendar_unverified' }
}

/** The n-th KRX trading day before `date`. */
export function previousKrxSessionDate(date: string, n: number): string {
  let cursor = date
  let counted = 0
  const maxSteps = Math.max(n, 1) * 4 + 21
  for (let i = 0; i < maxSteps; i++) {
    cursor = addCivilDays(cursor, -1)
    if (isKrxTradingDay(cursor)) {
      counted += 1
      if (counted === n) return cursor
    }
  }
  return cursor
}

/**
 * Last `n` trading days ending at `fromSessionDate` (inclusive if it is a
 * trading day), oldest→newest.
 */
export function lastNKrxSessionDates(fromSessionDate: string, n: number): string[] {
  if (n <= 0) return []
  const dates: string[] = []
  if (isKrxTradingDay(fromSessionDate)) dates.push(fromSessionDate)
  for (let i = 1; dates.length < n; i++) {
    dates.push(previousKrxSessionDate(fromSessionDate, i))
  }
  return dates.reverse()
}

/** Official KRX daily file for session D is expected at 08:00 KST on D+1. */
export const KRX_OFFICIAL_PUBLISH_HOUR_KST = 8

export function nextKstCivilDate(ymd: string): string {
  return addCivilDays(ymd, 1)
}

export function previousKstCivilDate(ymd: string): string {
  return addCivilDays(ymd, -1)
}

/** Instant the official daily file for `sessionDate` is expected (08:00 KST next civil day). */
export function krxOfficialPublishMs(sessionDate: string): number {
  const next = nextKstCivilDate(sessionDate)
  const { year, month, day } = parseYmd(next)
  return utcMsFromZonedLocal(KRX_TIME_ZONE, year, month, day, KRX_OFFICIAL_PUBLISH_HOUR_KST, 0)
}

export function krxOfficialIsPublished(sessionDate: string, now: Date): boolean {
  return now.getTime() >= krxOfficialPublishMs(sessionDate)
}

export function krxPrePublicationKind(
  sessionDate: string,
  now: Date,
): 'yesterday' | 'today' | 'later' {
  const today = kstCivilDate(now)
  if (sessionDate === today) return 'today'
  if (sessionDate === previousKstCivilDate(today)) return 'yesterday'
  return 'later'
}

export function resolveKrxGradingSession(
  resolvesAtDate: string,
  isTradingDay: (date: string) => boolean,
): string {
  if (isTradingDay(resolvesAtDate)) return resolvesAtDate
  let cursor = resolvesAtDate
  for (let i = 0; i < 370; i++) {
    cursor = addCivilDays(cursor, -1)
    if (isTradingDay(cursor)) return cursor
  }
  return cursor
}
