/**
 * JEJU multi-region weather forecast — Open-Meteo (key-less, CORS-enabled, the
 * same source the header uses for the live Jeju City readout). Fetched directly
 * from the client; no API key and no .env change required.
 *
 * `getJejuForecast()` requests a daily forecast for five Jeju regions in
 * parallel and fails gracefully: regions that error/time out are simply omitted,
 * so the panel can still show whatever succeeded.
 */

import type { TouristUiPack } from './tourist-labels'

/** The five Jeju forecast regions, with coordinates + their localized label key. */
export const JEJU_WEATHER_REGIONS = [
  { id: 'jejuCity', lat: 33.4996, lng: 126.5312, labelKey: 'wRegionJejuCity' },
  { id: 'seogwipo', lat: 33.2541, lng: 126.5601, labelKey: 'wRegionSeogwipo' },
  { id: 'east', lat: 33.4584, lng: 126.9425, labelKey: 'wRegionEast' },
  { id: 'west', lat: 33.2915, lng: 126.2425, labelKey: 'wRegionWest' },
  { id: 'hallasan', lat: 33.3617, lng: 126.5292, labelKey: 'wRegionHallasan' },
] as const

export type JejuRegionId = (typeof JEJU_WEATHER_REGIONS)[number]['id']

/** A single forecast day for one region. */
export interface ForecastDay {
  /** ISO date string (yyyy-mm-dd) in Asia/Seoul. */
  date: string
  /** Day of week 0–6 (Sun–Sat), tz-safe (parsed at UTC noon). */
  weekday: number
  weatherCode: number
  tempMax: number
  tempMin: number
  /** Max precipitation probability (%) — null when unavailable. */
  precipProb: number | null
  /** Max wind speed (km/h) — null when unavailable. */
  windMax: number | null
}

export interface RegionForecast {
  regionId: JejuRegionId
  days: ForecastDay[]
}

/** How many forecast days to request (Open-Meteo allows up to 16; we use 7). */
const FORECAST_DAYS = 7
const FETCH_TIMEOUT_MS = 10_000

/** Map a WMO weather code (Open-Meteo) to an emoji + localized condition key. */
export function mapWeatherCode(code: number): {
  conditionKey: keyof TouristUiPack
  emoji: string
} {
  if (code === 0) return { conditionKey: 'wxClear', emoji: '☀️' }
  if (code === 1 || code === 2) return { conditionKey: 'wxPartlyCloudy', emoji: '🌤️' }
  if (code === 3) return { conditionKey: 'wxCloudy', emoji: '☁️' }
  if (code === 45 || code === 48) return { conditionKey: 'wxFog', emoji: '🌫️' }
  if (code >= 51 && code <= 57) return { conditionKey: 'wxDrizzle', emoji: '🌦️' }
  if (code >= 95) return { conditionKey: 'wxThunder', emoji: '⛈️' }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return { conditionKey: 'wxSnow', emoji: '🌨️' }
  return { conditionKey: 'wxRain', emoji: '🌧️' }
}

/** Day-of-week (0–6) from a yyyy-mm-dd string, parsed at UTC noon to avoid tz drift. */
function weekdayFromIso(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? 0 : d.getUTCDay()
}

interface OpenMeteoDaily {
  time?: string[]
  weathercode?: number[]
  temperature_2m_max?: number[]
  temperature_2m_min?: number[]
  precipitation_probability_max?: (number | null)[]
  windspeed_10m_max?: (number | null)[]
}

/** Fetch + parse one region's daily forecast. Returns null on any failure. */
async function fetchRegion(
  region: (typeof JEJU_WEATHER_REGIONS)[number],
  signal: AbortSignal
): Promise<RegionForecast | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${region.lat}&longitude=${region.lng}` +
      `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max` +
      `&timezone=Asia%2FSeoul&forecast_days=${FORECAST_DAYS}`
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const data = (await res.json()) as { daily?: OpenMeteoDaily }
    const daily = data.daily
    const times = daily?.time
    const codes = daily?.weathercode
    const maxes = daily?.temperature_2m_max
    const mins = daily?.temperature_2m_min
    if (!times || !codes || !maxes || !mins) return null

    const precip = daily?.precipitation_probability_max
    const wind = daily?.windspeed_10m_max

    const days: ForecastDay[] = []
    for (let i = 0; i < times.length; i++) {
      const date = times[i]
      const code = codes[i]
      const tMax = maxes[i]
      const tMin = mins[i]
      if (date === undefined || code === undefined || tMax === undefined || tMin === undefined) {
        continue
      }
      days.push({
        date,
        weekday: weekdayFromIso(date),
        weatherCode: code,
        tempMax: Math.round(tMax),
        tempMin: Math.round(tMin),
        precipProb: typeof precip?.[i] === 'number' ? precip![i]! : null,
        windMax: typeof wind?.[i] === 'number' ? Math.round(wind![i]!) : null,
      })
    }
    if (days.length === 0) return null
    return { regionId: region.id, days }
  } catch {
    return null
  }
}

/**
 * Fetch the daily forecast for all five Jeju regions in parallel.
 * Returns only the regions that succeeded (empty array if all fail), preserving
 * the canonical region order. Never throws.
 */
export async function getJejuForecast(): Promise<RegionForecast[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const results = await Promise.all(
      JEJU_WEATHER_REGIONS.map((region) => fetchRegion(region, ctrl.signal))
    )
    return results.filter((r): r is RegionForecast => r !== null)
  } finally {
    clearTimeout(timer)
  }
}
