import { clamp, combineOr, finite, haversineKm, hoursBetween, percentileThreshold } from './math'
import {
  ADVISORY,
  COMPONENT_DEPARTMENT,
  CONFLICT,
  CYCLONE,
  FIRE,
  FOOD,
  GDACS,
  INTERNET,
  OBSERVED_RAIN,
  QUAKE,
  RAIN,
  RIVER,
  VOLCANO,
  HEALTH_ATTENTION,
} from './thresholds'
import { silenceFromSeries } from './silence'
import type { PointEvent, QuakeEvent, TriggerComponent } from './types'

function component(key: string, value: number, raw: Record<string, unknown>): TriggerComponent {
  return { key, department: COMPONENT_DEPARTMENT[key] ?? 'other', value: clamp(value), raw }
}

export function rainComponent(precipMm: Array<number | null> | null | undefined): TriggerComponent {
  const days = (precipMm ?? []).filter((value): value is number => value != null && Number.isFinite(value))
  const sum = days.reduce((acc, value) => acc + value, 0)
  const maxDay = days.reduce((acc, value) => Math.max(acc, value), 0)
  let value = 0
  if (sum >= RAIN.sumHardMm) value = RAIN.sumHardValue
  else if (sum >= RAIN.sumSoftMm) {
    value = RAIN.sumSoftValue +
      ((sum - RAIN.sumSoftMm) / (RAIN.sumHardMm - RAIN.sumSoftMm)) * (RAIN.sumHardValue - RAIN.sumSoftValue)
  }
  if (maxDay >= RAIN.dayMm) value = Math.max(value, RAIN.dayValue)
  return component('rain', value, { sum_mm: sum, max_day_mm: maxDay })
}

export interface ObservedRain {
  sum3: number
  maxDay: number
  days: string[]
  runs: string[]
}

/** Forecast high but three observed days low: x0.8. Observed heavy rain only marks the forecast confirmed. */
export function observedRainAdjust(rain: TriggerComponent, observed: ObservedRain | null): TriggerComponent {
  if (!observed) return rain
  const raw = { ...rain.raw, observed_3d_mm: observed.sum3, observed_max_day_mm: observed.maxDay, observed_days: observed.days, observed_runs: observed.runs }
  if (rain.value >= OBSERVED_RAIN.forecastHigh && observed.sum3 < OBSERVED_RAIN.lowSumMm) {
    return component('rain', rain.value * OBSERVED_RAIN.downgrade, { ...raw, observed: 'downgraded' })
  }
  if (observed.sum3 >= OBSERVED_RAIN.confirmSumMm || observed.maxDay >= RAIN.dayMm) {
    return component('rain', rain.value, { ...raw, observed: 'confirmed' })
  }
  return component('rain', rain.value, { ...raw, observed: 'neutral' })
}

function seriesMedian(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function riverComponent(opts: {
  discharge: Array<number | null> | null | undefined
  ratioTo30d?: Array<number | null> | null
  historyDays?: number
}): TriggerComponent {
  const ratios = (opts.ratioTo30d ?? []).filter((value): value is number => value != null && Number.isFinite(value))
  const discharge = (opts.discharge ?? []).filter((value): value is number => value != null && Number.isFinite(value))
  const peak = discharge.length ? Math.max(...discharge) : 0
  if (peak < RIVER.minPeakM3s) {
    return component('river', 0, { peak_m3s: peak, ratio: null, used: 'below_peak' })
  }
  const today = discharge[0] ?? 0
  const baseline = Math.max(today, seriesMedian(discharge), RIVER.minBaselineM3s)
  let ratio: number | null = null
  let used = 'none'
  const historyDays = opts.historyDays ?? 0
  if (historyDays >= RIVER.minHistoryDays && ratios.length) {
    ratio = Math.min(RIVER.ratioCap, Math.max(...ratios))
    used = 'ratio_to_30d_mean'
  } else if (discharge.length >= 2) {
    const nextMax = Math.max(...discharge.slice(1))
    ratio = Math.min(RIVER.ratioCap, nextMax / baseline)
    used = 'capped_peak_over_baseline'
  }
  let value = 0
  if (ratio != null) {
    if (ratio >= RIVER.ratioHard) value = RIVER.hardValue
    else if (ratio >= RIVER.ratioSoft) {
      value = RIVER.softValue +
        ((ratio - RIVER.ratioSoft) / (RIVER.ratioHard - RIVER.ratioSoft)) * (RIVER.hardValue - RIVER.softValue)
    }
  }
  return component('river', value, { peak_m3s: peak, baseline_m3s: baseline, ratio, used, history_days: historyDays })
}

export function cycloneComponent(
  lat: number,
  lon: number,
  now: Date,
  tracks: PointEvent[],
): TriggerComponent {
  let bestKm = Infinity
  let hits = 0
  const horizon = now.getTime() + CYCLONE.horizonDays * 86_400_000
  for (const point of tracks) {
    const t = point.event_time ? Date.parse(point.event_time) : now.getTime()
    if (!Number.isFinite(t) || t < now.getTime() - 86_400_000 || t > horizon) continue
    const km = haversineKm(lat, lon, point.lat, point.lon)
    hits += 1
    if (km < bestKm) bestKm = km
  }
  let value = 0
  if (Number.isFinite(bestKm) && bestKm <= CYCLONE.closeKm) value = CYCLONE.closeValue
  else if (Number.isFinite(bestKm) && bestKm <= CYCLONE.nearKm) value = CYCLONE.nearValue
  return component('cyclone', value, { nearest_km: Number.isFinite(bestKm) ? bestKm : null, points: hits })
}

export function quakeComponent(lat: number, lon: number, now: Date, events: QuakeEvent[]): TriggerComponent {
  let best: { mag: number; km: number } | null = null
  let swarm = 0
  const week = now.getTime() - QUAKE.days * 86_400_000
  const swarmFrom = now.getTime() - QUAKE.swarmHours * 3_600_000
  for (const event of events) {
    const t = event.event_time ? Date.parse(event.event_time) : NaN
    if (Number.isFinite(t) && t < week) continue
    const km = haversineKm(lat, lon, event.lat, event.lon)
    if (km <= QUAKE.nearKm && (!best || event.mag > best.mag || (event.mag === best.mag && km < best.km))) {
      best = { mag: event.mag, km }
    }
    if (event.source === 'emsc' && km <= QUAKE.swarmKm && (!Number.isFinite(t) || t >= swarmFrom)) swarm += 1
  }
  let value = 0
  if (best && best.mag >= QUAKE.magHard) value = QUAKE.magHardValue
  else if (best && best.mag >= QUAKE.magSoft) value = QUAKE.magSoftValue
  if (swarm >= QUAKE.swarmCount) value = Math.max(value, QUAKE.swarmValue)
  return component('quake', value, { mag: best?.mag ?? null, km: best?.km ?? null, swarm })
}

function alertValue(alert: string | null | undefined, orange: number, red: number): number {
  const key = (alert ?? '').trim().toLowerCase()
  if (key === 'red') return red
  if (key === 'orange' || key === 'amber') return orange
  return 0
}

export function gdacsComponent(
  lat: number,
  lon: number,
  regionId: number,
  iso3: string | null,
  now: Date,
  events: PointEvent[],
): TriggerComponent {
  let value = 0
  let used: string | null = null
  const since = now.getTime() - GDACS.days * 86_400_000
  for (const event of events) {
    const t = event.event_time ? Date.parse(event.event_time) : now.getTime()
    if (Number.isFinite(t) && t < since) continue
    const near =
      event.region_id === regionId ||
      (iso3 && event.country_iso3 === iso3) ||
      haversineKm(lat, lon, event.lat, event.lon) <= GDACS.nearKm
    if (!near) continue
    const next = alertValue(event.alert, GDACS.orangeValue, GDACS.redValue)
    if (next > value) {
      value = next
      used = event.alert ?? null
    }
  }
  return component('gdacs', value, { alert: used })
}

export function volcanoComponent(
  lat: number,
  lon: number,
  now: Date,
  events: PointEvent[],
): TriggerComponent {
  let value = 0
  let used: string | null = null
  const since = now.getTime() - VOLCANO.days * 86_400_000
  for (const event of events) {
    const t = event.event_time ? Date.parse(event.event_time) : now.getTime()
    if (Number.isFinite(t) && t < since) continue
    if (haversineKm(lat, lon, event.lat, event.lon) > VOLCANO.nearKm) continue
    const next = alertValue(event.alert, VOLCANO.orangeValue, VOLCANO.redValue)
    if (next > value) {
      value = next
      used = event.alert ?? null
    }
  }
  return component('volcano', value, { alert: used })
}

export function fireComponent(opts: {
  frpSum: number
  count?: number
  top1Cut: number | null
  watchlist: boolean
}): TriggerComponent {
  const count = opts.count ?? 0
  const inTail = opts.top1Cut != null && opts.frpSum >= opts.top1Cut
  const detected = opts.frpSum > 0 && (inTail || count >= FIRE.minCount)
  let value = 0
  if (detected) {
    value = FIRE.topValue
    if (opts.watchlist) value = Math.min(1, value * FIRE.watchlistMultiplier)
  }
  return component('fire', value, {
    frp_sum: opts.frpSum,
    count,
    watchlist: opts.watchlist,
    detected,
    top1_cut: opts.top1Cut,
  })
}

export function conflictComponent(opts: {
  conflictCount: number
  mean30d: number | null
  historyDays: number
  absCut: number | null
}): TriggerComponent {
  let value = 0
  let ratio: number | null = null
  if (opts.historyDays >= CONFLICT.minHistoryDays && opts.mean30d != null && opts.mean30d > 0) {
    ratio = opts.conflictCount / opts.mean30d
    if (ratio >= CONFLICT.ratioHard) value = CONFLICT.hardValue
    else if (ratio >= CONFLICT.ratioSoft) {
      value = CONFLICT.softValue +
        ((ratio - CONFLICT.ratioSoft) / (CONFLICT.ratioHard - CONFLICT.ratioSoft)) * (CONFLICT.hardValue - CONFLICT.softValue)
    }
  } else if (opts.absCut != null && opts.conflictCount > 0 && opts.conflictCount >= opts.absCut) {
    value = CONFLICT.absValue
  }
  return component('conflict', value, {
    count: opts.conflictCount,
    mean_30d: opts.mean30d,
    history_days: opts.historyDays,
    ratio,
  })
}

export function silenceComponent(opts: {
  series: Array<{ day: string; total: number; cameo: number }>
  now: Date
}): TriggerComponent {
  const scored = silenceFromSeries(opts.series, opts.now)
  return component('silence', scored.value, scored.raw)
}

/** Active when IODA or Cloudflare reports an outage (max of the two). Corroborated when both do. */
export function internetComponent(active: boolean, raw: Record<string, unknown> = {}): TriggerComponent {
  return component('internet', active ? INTERNET.value : 0, raw)
}

export function internetRaw(sources: string[]): Record<string, unknown> {
  const ioda = sources.includes('ioda')
  const cloudflare = sources.includes('cloudflare')
  return { sources: [...sources].sort(), ioda, cloudflare, corroborated: ioda && cloudflare }
}

/** Cloudflare outages stay active while open (no end date) or until their end is inside the window. */
export function outageActive(opts: { source: string; eventTime: string | null; until: string | null }, sinceIso: string): boolean {
  const start = opts.eventTime ?? sinceIso
  if (start >= sinceIso) return true
  if (opts.source !== 'cloudflare') return false
  return opts.until == null || opts.until >= sinceIso
}

export function advisoryComponent(opts: { changed: boolean; diverge: boolean }): TriggerComponent {
  let value = 0
  if (opts.changed) value = ADVISORY.changeValue
  if (opts.diverge) value = Math.max(value, ADVISORY.divergeValue)
  return component('advisory', value, { change: opts.changed, diverge: opts.diverge })
}

/** Wiki is an amplifier, not a trigger. The component stays at 0 so old callers cannot fire it. */
export function wikiComponent(_freshHazard: boolean, title: string | null = null): TriggerComponent {
  return component('wiki', 0, { title, role: 'context' })
}

export function healthAttentionComponent(active: boolean, title: string | null = null): TriggerComponent {
  return component('health_attention', active ? HEALTH_ATTENTION.value : 0, { title, scope: 'country' })
}

export function escalationComponent(value: number, raw: Record<string, unknown> = {}): TriggerComponent {
  return component('escalation', value, raw)
}

export function slowBurnComponent(value: number, raw: Record<string, unknown> = {}): TriggerComponent {
  return component('slow_burn', value, raw)
}

export function foodComponent(ipc: number | null): TriggerComponent {
  let value = 0
  if (ipc != null && ipc >= FOOD.ipcHard) value = FOOD.hardValue
  else if (ipc != null && ipc >= FOOD.ipcSoft) value = FOOD.softValue
  return component('food', value, { ipc })
}

export function combineTrigger(components: TriggerComponent[]): number {
  return combineOr(components.map((row) => row.value))
}

export function fireCuts(frpByRegion: Map<number, number>): number | null {
  return percentileThreshold([...frpByRegion.values()], FIRE.topPercentile)
}

export function conflictAbsCut(counts: number[]): number | null {
  return percentileThreshold(counts.filter((value) => value > 0), CONFLICT.absTopPercentile)
}

export function isActiveOutage(eventTime: string | null | undefined, now: Date): boolean {
  if (!eventTime) return true
  const t = Date.parse(eventTime)
  if (!Number.isFinite(t)) return true
  return hoursBetween(now, new Date(t)) <= INTERNET.activeHours
}

export function finiteMetric(value: unknown): number | null {
  return finite(value)
}
