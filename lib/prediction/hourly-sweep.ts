/**
 * Hourly due-round grading gate. Pure — the cron supplies the clock and the
 * existing `gradeAllDueRounds()` verb (no args, no target selection).
 */

/** First N UTC minutes of each hour. A delayed :01/:02 tick still runs. */
export const HOURLY_GRADING_SWEEP_MINUTE_WINDOW = 3

export function shouldRunHourlyGradingSweep(now: Date = new Date()): boolean {
  return now.getUTCMinutes() < HOURLY_GRADING_SWEEP_MINUTE_WINDOW
}
