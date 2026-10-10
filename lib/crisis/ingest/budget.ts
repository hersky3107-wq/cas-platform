/** Open-Meteo billed-call weight. The free forecast response has no per-day cost header, including forecast_days=16. */
export const OPEN_METEO_FORECAST_7D_WEIGHT = 1

export const OPENMETEO_DAILY_BILLED_CAP = 5000
export const GLOFAS_DAILY_BILLED_CAP = 4000
export const OPENMETEO_MINUTE_BILLED_CAP = 500
export const OPENMETEO_BATCH_SIZE = 100
export const OPENMETEO_MAX_URL_CHARS = 7000
export const OPENMETEO_COORD_DECIMALS = 3

/** Milliseconds to sleep so `additional` billed calls stay under the rolling 60s cap. */
export function sleepMsForMinuteBudget(
  timestamps: number[],
  additional: number,
  now = Date.now(),
  cap = OPENMETEO_MINUTE_BILLED_CAP,
): number {
  if (additional <= 0) return 0
  if (additional > cap) return 60_000
  const window = timestamps.filter((t) => now - t < 60_000).sort((a, b) => a - b)
  if (window.length + additional <= cap) return 0
  const overflow = window.length + additional - cap
  const expireAt = window[overflow - 1] + 60_000
  return Math.max(0, expireAt - now)
}

export function recordBilledCalls(timestamps: number[], count: number, now = Date.now()): number[] {
  const next = timestamps.filter((t) => now - t < 60_000)
  for (let i = 0; i < count; i += 1) next.push(now)
  return next
}

export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function estimateBilledCalls(locationCount: number, weight = OPEN_METEO_FORECAST_7D_WEIGHT): number {
  if (locationCount <= 0) return 0
  return Math.ceil(locationCount * weight)
}

export function wouldExceedBudget(used: number, additional: number, cap: number): boolean {
  return used + additional > cap
}

export function remainingBudget(used: number, cap: number): number {
  return Math.max(0, cap - used)
}

export interface BudgetCursor {
  billed_date?: string
  billed_calls?: number
}

export function billedCallsToday(cursor: BudgetCursor | null | undefined, now: Date): number {
  if (!cursor) return 0
  if (cursor.billed_date !== utcDayKey(now)) return 0
  const n = Number(cursor.billed_calls)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function nextBudgetCursor(cursor: BudgetCursor | null | undefined, now: Date, additional: number): BudgetCursor {
  const day = utcDayKey(now)
  const used = billedCallsToday(cursor, now)
  return { billed_date: day, billed_calls: used + additional }
}
