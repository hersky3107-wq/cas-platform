import type { ClimateNormals, MonthNormal } from './stats'
import { populationWeight, wetBulbC, windChillC } from './thermo'

export interface ForecastDay {
  date: string
  tmax: number | null
  tmin: number | null
  rh: number | null
  wind: number | null
}

export interface Spell {
  key: 'heat' | 'cold' | 'drought'
  value: number
  raw: Record<string, unknown>
}

const WET_BULB_HOT = 31
const WET_BULB_EXTREME = 33
const WIND_CHILL_EXTREME = -27
const WIND_CHILL_SEVERE = -35

function monthNormal(normals: ClimateNormals | null, date: string): MonthNormal | null {
  const month = Number(date.slice(5, 7))
  if (!normals || month < 1 || month > 12) return null
  return normals.months.find((row) => row.month === month) ?? null
}

function longestRun(flags: boolean[]): { start: number; end: number; length: number } | null {
  let best: { start: number; end: number; length: number } | null = null
  let start = -1
  for (let i = 0; i <= flags.length; i += 1) {
    if (i < flags.length && flags[i]) {
      if (start < 0) start = i
    } else if (start >= 0) {
      const length = i - start
      if (!best || length > best.length) best = { start, end: i - 1, length }
      start = -1
    }
  }
  return best
}

function pickSpell(
  wetRun: { start: number; end: number; length: number } | null,
  hotRun: { start: number; end: number; length: number } | null,
): { start: number; end: number; length: number } | null {
  const runs = [wetRun, hotRun].filter((run): run is { start: number; end: number; length: number } => run != null && run.length >= 3)
  runs.sort((a, b) => b.length - a.length)
  return runs[0] ?? null
}

function lead(start: number, end: number): { lead_min: number; lead_max: number } {
  const min = Math.max(1, start)
  return { lead_min: min, lead_max: Math.max(min, end) }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function assessHeatCold(opts: {
  days: ForecastDay[]
  normals: ClimateNormals | null
  population: number
}): Spell[] {
  const weight = populationWeight(opts.population)
  const hot: boolean[] = []
  const cold: boolean[] = []
  const wetHot: boolean[] = []
  let peakWet = -Infinity
  let peakWetIndex = -1
  let peakChill = Infinity
  let peakChillIndex = -1
  let peakTmax = -Infinity
  let peakTmin = Infinity
  opts.days.forEach((day, index) => {
    const normal = monthNormal(opts.normals, day.date)
    hot.push(day.tmax != null && normal?.tmaxP95 != null && day.tmax > normal.tmaxP95)
    cold.push(day.tmin != null && normal?.tminP5 != null && day.tmin < normal.tminP5)
    if (day.tmax != null && day.rh != null) {
      const wet = wetBulbC(day.tmax, day.rh)
      wetHot.push(wet >= WET_BULB_HOT)
      if (wet > peakWet) {
        peakWet = wet
        peakWetIndex = index
      }
    } else {
      wetHot.push(false)
    }
    if (day.tmin != null && day.wind != null) {
      const chill = windChillC(day.tmin, day.wind)
      if (chill != null && chill < peakChill) {
        peakChill = chill
        peakChillIndex = index
      }
    }
    if (day.tmax != null && day.tmax > peakTmax) peakTmax = day.tmax
    if (day.tmin != null && day.tmin < peakTmin) peakTmin = day.tmin
  })
  const hotRun = longestRun(hot)
  const wetRun = longestRun(wetHot)
  const coldRun = longestRun(cold)
  const out: Spell[] = []
  const heatValue = heatStrength(hotRun?.length ?? 0, Number.isFinite(peakWet) ? peakWet : null)
  if (heatValue > 0) {
    const spell = pickSpell(wetRun, hotRun)
    const index = spell ? spell.start : peakWetIndex
    const end = spell ? spell.end : peakWetIndex
    const normal = index >= 0 ? monthNormal(opts.normals, opts.days[index]?.date ?? '') : null
    const anomaly = normal?.tmaxMean != null && Number.isFinite(peakTmax) ? round1(peakTmax - normal.tmaxMean) : null
    out.push({
      key: 'heat',
      value: heatValue * weight,
      raw: {
        wet_bulb_c: Number.isFinite(peakWet) ? round1(peakWet) : null,
        consecutive_days: spell?.length ?? (peakWet >= WET_BULB_HOT ? 1 : 0),
        anomaly_c: anomaly,
        ...lead(Math.max(0, index), Math.max(0, end)),
        population: opts.population,
      },
    })
  }
  const coldValue = coldStrength(coldRun?.length ?? 0, Number.isFinite(peakChill) ? peakChill : null)
  if (coldValue > 0) {
    const spell = coldRun && coldRun.length >= 3 ? coldRun : null
    const index = spell ? spell.start : peakChillIndex
    const end = spell ? spell.end : peakChillIndex
    const normal = index >= 0 ? monthNormal(opts.normals, opts.days[index]?.date ?? '') : null
    const shown = Number.isFinite(peakChill) ? peakChill : peakTmin
    const anomaly = normal?.tminMean != null && Number.isFinite(shown) ? round1(shown - normal.tminMean) : null
    out.push({
      key: 'cold',
      value: coldValue * weight,
      raw: {
        wind_chill_c: Number.isFinite(peakChill) ? round1(peakChill) : null,
        tmin_c: Number.isFinite(peakTmin) ? round1(peakTmin) : null,
        consecutive_days: spell?.length ?? (peakChill <= WIND_CHILL_EXTREME ? 1 : 0),
        anomaly_c: anomaly,
        ...lead(Math.max(0, index), Math.max(0, end)),
        population: opts.population,
      },
    })
  }
  return out
}

function heatStrength(hotDays: number, wetBulb: number | null): number {
  let value = 0
  if (hotDays >= 3) value = 0.62
  if (wetBulb != null && wetBulb >= WET_BULB_HOT) value = Math.max(value, 0.8)
  if (wetBulb != null && wetBulb >= WET_BULB_EXTREME) value = 1
  return value
}

function coldStrength(coldDays: number, windChill: number | null): number {
  let value = 0
  if (coldDays >= 3) value = 0.62
  if (windChill != null && windChill <= WIND_CHILL_EXTREME) value = Math.max(value, 0.85)
  if (windChill != null && windChill <= WIND_CHILL_SEVERE) value = 1
  return value
}

export function ensoActive(status: string | null | undefined, anomaly: number | null | undefined): boolean {
  const text = status ?? ''
  if (/advisory/i.test(text) && /niñ|nin/i.test(text)) return true
  if (/neutral/i.test(text)) return false
  return typeof anomaly === 'number' && Math.abs(anomaly) >= 0.5
}

export function assessDrought(opts: {
  normals: ClimateNormals | null
  population: number
  ensoStatus: string | null
  ensoAnomaly: number | null
}): Spell | null {
  if (!opts.normals) return null
  const factors: string[] = []
  const rainBase = opts.normals.precip90dBase
  const rain = opts.normals.precip90d
  let rainRatio: number | null = null
  if (rain != null && rainBase != null && rainBase >= 20) {
    rainRatio = rain / rainBase
    if (rainRatio < 0.75) factors.push('rain')
  }
  const month = opts.normals.months.find((row) => row.soilMean != null && row.soilMean > 0.02)
  const soilMean = month?.soilMean ?? null
  if (opts.normals.soilRecent != null && soilMean != null && opts.normals.soilRecent < soilMean * 0.85) {
    factors.push('soil')
  }
  if (ensoActive(opts.ensoStatus, opts.ensoAnomaly)) factors.push('enso')
  if (factors.length < 2) return null
  const value = Math.min(1, 0.5 + 0.2 * (factors.length - 2)) * populationWeight(opts.population)
  return {
    key: 'drought',
    value,
    raw: {
      factors,
      rain_ratio: rainRatio == null ? null : Math.round(rainRatio * 100) / 100,
      precip_90d: rain,
      precip_90d_base: rainBase,
      soil_recent: opts.normals.soilRecent,
      enso: opts.ensoStatus,
      population: opts.population,
    },
  }
}
