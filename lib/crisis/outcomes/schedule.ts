import { isFixedScheduleDue, type FixedSchedule } from '../ingest/schedule'

/** Daily outcome check. 10:30 Asia/Seoul, once per local day. */
export const OUTCOMES_SCHEDULE: FixedSchedule = {
  cadence: 'daily',
  hour: 10,
  minute: 30,
  timeZone: 'Asia/Seoul',
}

export function outcomesDue(lastSuccessAt: string | null | undefined, now: Date): boolean {
  return isFixedScheduleDue(OUTCOMES_SCHEDULE, lastSuccessAt, now)
}
