import { HAZARD_REGISTRY, type HazardKind, type LeadTimeBand } from '../hazards'

const DAY_MS = 86_400_000
const MAX_WINDOW_DAYS = 90

const BAND_DAYS: Record<LeadTimeBand, { min: number; max: number }> = {
  hours_24_72: { min: 1, max: 3 },
  days_3_7: { min: 3, max: 7 },
  weeks_1_2: { min: 7, max: 14 },
  weeks_2_6: { min: 14, max: 42 },
  months_1_3: { min: 30, max: 90 },
  unknown: { min: 3, max: 14 },
}

const HAZARD_ALIASES: Array<{ re: RegExp; kind: HazardKind }> = [
  { re: /erupt|volcano/i, kind: 'volcano' },
  { re: /outbreak|dengue|cholera|epidemic|disease/i, kind: 'epidemic' },
  { re: /spill|dam/i, kind: 'dam_failure' },
  { re: /collapse|landslide/i, kind: 'landslide' },
  { re: /displac|conflict|refugee/i, kind: 'conflict' },
  { re: /road|flood|rain/i, kind: 'flood_rain' },
  { re: /quake|earthquake/i, kind: 'earthquake' },
  { re: /cyclone|typhoon|storm/i, kind: 'cyclone' },
  { re: /fire/i, kind: 'wildfire' },
]

export interface DatedWindow {
  min_days: number
  max_days: number
  start: string
  end: string
  /** Korean card line, e.g. 예상 시기: 3~7일 뒤 */
  label: string
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

export function daysBetween(start: string, end: string): number | null {
  const a = Date.parse(`${start}T00:00:00Z`)
  const b = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / DAY_MS)
}

export function hazardKindFromText(text: string): HazardKind {
  for (const row of HAZARD_ALIASES) {
    if (row.re.test(text)) return row.kind
  }
  return 'gradual_worsening'
}

export function bandDays(kind: HazardKind): { min: number; max: number } {
  return BAND_DAYS[HAZARD_REGISTRY[kind].leadTimeBand]
}

export function windowLabel(minDays: number, maxDays: number): string {
  const min = Math.max(0, Math.round(minDays))
  const max = Math.max(min, Math.round(maxDays))
  if (min === max) return `예상 시기: ${min}일 뒤`
  return `예상 시기: ${min}~${max}일 뒤`
}

export function windowFromDays(now: Date, minDays: number, maxDays: number): DatedWindow {
  const min = Math.max(0, Math.min(MAX_WINDOW_DAYS, Math.round(minDays)))
  const max = Math.max(min, Math.min(MAX_WINDOW_DAYS, Math.round(maxDays)))
  return {
    min_days: min,
    max_days: max,
    start: isoDate(addDays(now, min)),
    end: isoDate(addDays(now, max)),
    label: windowLabel(min, max),
  }
}

export function windowFromLead(lead: { min: number; max: number } | undefined, now: Date, hint = ''): DatedWindow {
  if (lead && Number.isFinite(lead.min) && Number.isFinite(lead.max)) {
    return windowFromDays(now, lead.min, lead.max)
  }
  const band = bandDays(hazardKindFromText(hint))
  return windowFromDays(now, band.min, band.max)
}

/** Keep a judge window when it sits inside 90 days; otherwise use the hazard lead-time band. */
export function resolvePredictionWindow(
  raw: { window_start?: string; window_end?: string },
  now: Date,
  hint: string,
): DatedWindow | null {
  const span = raw.window_start && raw.window_end ? daysBetween(raw.window_start, raw.window_end) : null
  const startOk = raw.window_start ? Date.parse(`${raw.window_start}T00:00:00Z`) : NaN
  const fromNow = Number.isFinite(startOk) ? Math.round((startOk - Date.parse(isoDate(now) + 'T00:00:00Z')) / DAY_MS) : null
  if (span != null && span >= 0 && span <= MAX_WINDOW_DAYS && fromNow != null && fromNow >= -1 && fromNow + span <= MAX_WINDOW_DAYS) {
    const min = Math.max(0, fromNow)
    const max = min + span
    return {
      min_days: min,
      max_days: max,
      start: isoDate(addDays(now, min)),
      end: isoDate(addDays(now, max)),
      label: windowLabel(min, max),
    }
  }
  if (span != null && (span < 0 || span > MAX_WINDOW_DAYS)) return null
  const band = bandDays(hazardKindFromText(hint))
  return windowFromDays(now, band.min, band.max)
}
