/**
 * NYSE full-day closures. Weekends are not listed. Early closes still count
 * as a session (grading pins resolves_at to the UTC end of that date).
 *
 * 2026–2027 from the published NYSE holiday schedule. Past
 * US_EQUITY_CALENDAR_VALID_THROUGH, session counting refuses rather than
 * guessing.
 */

export const US_EQUITY_CALENDAR_VALID_THROUGH = '2027-12-31'

export const US_EQUITY_HOLIDAYS: ReadonlySet<string> = new Set([
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18',
  '2027-07-05',
  '2027-09-06',
  '2027-11-25',
  '2027-12-24',
])

export function isUsEquityHoliday(ymd: string): boolean {
  return US_EQUITY_HOLIDAYS.has(ymd)
}

/** Mon–Fri and not an NYSE holiday. */
export function isUsEquityTradingDay(ymd: string): boolean {
  const [ys, ms, ds] = ymd.split('-')
  const weekday = new Date(Date.UTC(Number(ys), Number(ms) - 1, Number(ds))).getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  return !isUsEquityHoliday(ymd)
}
