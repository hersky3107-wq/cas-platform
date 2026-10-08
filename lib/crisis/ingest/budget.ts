/** Open-Meteo billed-call weight for forecast_days=7 (probe: factor 1.0 per location). */
export const OPEN_METEO_FORECAST_7D_WEIGHT = 1

export const OPENMETEO_DAILY_BILLED_CAP = 5000
export const GLOFAS_DAILY_BILLED_CAP = 4000

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
