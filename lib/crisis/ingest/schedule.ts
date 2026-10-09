export const SCHEDULE_TIMEZONE = 'Asia/Seoul' as const

export type FixedCadence = 'daily' | 'weekly' | 'monthly'

export interface FixedSchedule {
  cadence: FixedCadence
  hour: number
  minute: number
  /** 0=Sunday ... 6=Saturday. Weekly only. Default Monday. */
  weekday?: number
  /** Monthly only. Default 1. */
  dayOfMonth?: number
  timeZone: typeof SCHEDULE_TIMEZONE
}

export const FIXED_SLOTS = {
  openmeteo_forecast: { cadence: 'daily', hour: 9, minute: 30, timeZone: SCHEDULE_TIMEZONE },
  glofas: { cadence: 'daily', hour: 9, minute: 45, timeZone: SCHEDULE_TIMEZONE },
  wiki_top: { cadence: 'daily', hour: 10, minute: 0, timeZone: SCHEDULE_TIMEZONE },
  fewsnet: { cadence: 'weekly', hour: 10, minute: 15, weekday: 1, timeZone: SCHEDULE_TIMEZONE },
  inform: { cadence: 'monthly', hour: 10, minute: 30, dayOfMonth: 1, timeZone: SCHEDULE_TIMEZONE },
} as const satisfies Record<string, FixedSchedule>

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export interface SeoulParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
  dateKey: string
}

export function seoulParts(now: Date): SeoulParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  })
  const bag = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]))
  let hour = Number(bag.hour)
  if (hour === 24) hour = 0
  const minute = Number(bag.minute)
  const year = Number(bag.year)
  const month = Number(bag.month)
  const day = Number(bag.day)
  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: WEEKDAY[bag.weekday] ?? 0,
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

function matchesCadenceDay(parts: SeoulParts, schedule: FixedSchedule): boolean {
  if (schedule.cadence === 'weekly' && parts.weekday !== (schedule.weekday ?? 1)) return false
  if (schedule.cadence === 'monthly' && parts.day !== (schedule.dayOfMonth ?? 1)) return false
  return true
}

/** Due after the Seoul slot on the cadence day, including a later tick the same local day. At most once that day. */
export function isFixedScheduleDue(
  schedule: FixedSchedule,
  lastSuccessAt: string | null | undefined,
  now: Date,
): boolean {
  const parts = seoulParts(now)
  if (!matchesCadenceDay(parts, schedule)) return false
  const nowMin = parts.hour * 60 + parts.minute
  const slotMin = schedule.hour * 60 + schedule.minute
  if (nowMin < slotMin) return false
  if (lastSuccessAt) {
    const lastKey = seoulParts(new Date(lastSuccessAt)).dateKey
    if (lastKey === parts.dateKey) return false
  }
  return true
}

function seoulSlotUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0))
}

function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

/** Next Seoul slot strictly after `now`. */
export function nextFixedSlot(schedule: FixedSchedule, now: Date): Date {
  const start = seoulParts(now)
  for (let offset = 0; offset < 40; offset += 1) {
    const day = addDays(start.year, start.month, start.day, offset)
    const probe = seoulSlotUtc(day.year, day.month, day.day, 12, 0)
    const parts = seoulParts(probe)
    if (!matchesCadenceDay(parts, schedule)) continue
    const slot = seoulSlotUtc(parts.year, parts.month, parts.day, schedule.hour, schedule.minute)
    if (slot.getTime() > now.getTime()) return slot
  }
  return new Date(now.getTime() + 24 * 3600_000)
}

export function nextDueAt(
  source: { scheduleMinutes: number; fixedSchedule?: FixedSchedule },
  now: Date,
): Date {
  if (source.fixedSchedule) return nextFixedSlot(source.fixedSchedule, now)
  return new Date(now.getTime() + source.scheduleMinutes * 60_000)
}
