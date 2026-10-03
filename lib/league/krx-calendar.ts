/**
 * KRX (Korea Exchange) trading-day calendar. Pure — no network.
 *
 * Earlier 2026 dates omitted (not needed for forward generation). 2027 must be
 * added when KRX publishes its annual holiday notice (usually December).
 * Source: KRX holiday notice.
 */

export const KRX_TIME_ZONE = 'Asia/Seoul'
export const KRX_OPEN_HOUR = 9
export const KRX_OPEN_MINUTE = 0
export const KRX_CLOSE_HOUR = 15
export const KRX_CLOSE_MINUTE = 30

export const KRX_CALENDAR_VALID_THROUGH = '2026-12-31'

/**
 * KST dates "YYYY-MM-DD". Verified 2026 holidays from 2026-08-17 onward.
 * Earlier 2026 dates omitted (not needed for forward generation). 2027 must
 * be added when KRX publishes its annual holiday notice (usually December).
 * Source: KRX holiday notice.
 */
export const KRX_HOLIDAYS: ReadonlySet<string> = new Set([
  '2026-08-17',
  '2026-09-24',
  '2026-09-25',
  '2026-10-05',
  '2026-10-09',
  '2026-12-25',
  '2026-12-31',
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
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: KRX_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
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
