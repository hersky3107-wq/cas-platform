import { haversineKm } from './math'
import { CYCLONE, QUAKE } from './thresholds'
import type { PointEvent, TriggerComponent } from './types'
import {
  type ExpectedWindow,
  type HazardKind,
  HAZARD_REGISTRY,
  hazardKindForScoreTrigger,
} from '../hazards'

export interface TriggerEnrichContext {
  now: Date
  lat: number
  lon: number
  precip: Array<number | null> | null
  discharge: Array<number | null> | null
  cycloneTracks: PointEvent[]
}

function peakDayIndex(values: Array<number | null> | null | undefined): number | null {
  const rows = (values ?? []).map((value, index) => ({ value, index })).filter((row) => row.value != null && Number.isFinite(row.value))
  if (rows.length === 0) return null
  rows.sort((a, b) => (b.value as number) - (a.value as number))
  return rows[0].index + 1
}

function daysWindowFromPeak(peakDay1Based: number): ExpectedWindow {
  const min = Math.max(1, peakDay1Based - 1)
  const max = peakDay1Based + 1
  return { type: 'relative_days', min, max }
}

function cycloneEtaDays(lat: number, lon: number, now: Date, tracks: PointEvent[]): ExpectedWindow | null {
  let bestMs: number | null = null
  const horizon = now.getTime() + CYCLONE.horizonDays * 86_400_000
  for (const point of tracks) {
    const t = point.event_time ? Date.parse(point.event_time) : NaN
    if (!Number.isFinite(t) || t < now.getTime() || t > horizon) continue
    const km = haversineKm(lat, lon, point.lat, point.lon)
    if (km > CYCLONE.nearKm) continue
    if (bestMs == null || t < bestMs) bestMs = t
  }
  if (bestMs == null) return null
  const days = Math.max(1, Math.round((bestMs - now.getTime()) / 86_400_000))
  return { type: 'relative_days', min: Math.max(1, days - 1), max: days + 1 }
}

export function expectedWindowForComponent(
  component: TriggerComponent,
  kind: HazardKind,
  ctx: TriggerEnrichContext,
): ExpectedWindow {
  const raw = component.raw ?? {}
  const band = HAZARD_REGISTRY[kind]?.leadTimeBand ?? 'unknown'

  if (component.key === 'rain') {
    const peak = peakDayIndex(ctx.precip)
    if (peak != null) return daysWindowFromPeak(peak)
  }
  if (component.key === 'river') {
    const peak = peakDayIndex(ctx.discharge)
    if (peak != null) return daysWindowFromPeak(peak)
  }
  if (component.key === 'cyclone') {
    const eta = cycloneEtaDays(ctx.lat, ctx.lon, ctx.now, ctx.cycloneTracks)
    if (eta) return eta
  }
  if (component.key === 'quake' && raw.forecast === 'probability') {
    return { type: 'lead', key: 'days_to_weeks' }
  }
  if (component.key === 'quake' && typeof raw.mag === 'number' && raw.mag >= QUAKE.magSoft) {
    return { type: 'relative_hours', min: 24, max: 72 }
  }
  if (component.key === 'heat' || component.key === 'cold') {
    const min = typeof raw.lead_min === 'number' ? raw.lead_min : null
    const max = typeof raw.lead_max === 'number' ? raw.lead_max : null
    if (min != null && max != null) return { type: 'relative_days', min, max }
  }
  if (component.key === 'drought' || component.key === 'food' || kind === 'drought') {
    return { type: 'relative_months', min: 1, max: 3 }
  }
  if (component.key === 'internet') {
    return { type: 'relative_hours', min: 24, max: 72 }
  }
  if (component.key === 'conflict' || component.key === 'escalation') {
    return { type: 'relative_days', min: 3, max: 7 }
  }
  if (component.key === 'slow_burn' || component.key === 'silence') {
    return { type: 'relative_days', min: 14, max: 42 }
  }
  if (component.key === 'health_attention') {
    return { type: 'relative_days', min: 7, max: 14 }
  }
  if (component.key === 'advisory') {
    return { type: 'relative_days', min: 3, max: 7 }
  }
  if (component.key === 'fire') {
    return { type: 'relative_days', min: 3, max: 7 }
  }
  if (component.key === 'volcano' && raw.forecast === 'probability') {
    return { type: 'lead', key: 'days_to_weeks' }
  }
  if (component.key === 'volcano') {
    return { type: 'relative_days', min: 7, max: 14 }
  }
  return { type: 'band', band }
}

export function enrichTriggerComponents(components: TriggerComponent[], ctx: TriggerEnrichContext): TriggerComponent[] {
  return components.map((row) => {
    if (row.value <= 0) return row
    const kind = hazardKindForScoreTrigger(row.key, row.raw)
    const expected_window = expectedWindowForComponent(row, kind, ctx)
    return {
      ...row,
      raw: {
        ...row.raw,
        hazard_kind: kind,
        expected_window,
      },
    }
  })
}
