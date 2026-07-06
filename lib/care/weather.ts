/**
 * Weather forecast for the care app — nationwide, residence-driven.
 *
 * Nationalized from the Jeju version: instead of five fixed Jeju regions, this
 * fetches a single-location daily forecast for the user's residence lat/lng
 * (from lib/care/residence). Open-Meteo is key-less and works for any
 * coordinates in Korea. Fetched directly from the client; no API key / .env.
 */

import type { TouristUiPack } from '@/lib/jeju/tourist-labels'

/** A single forecast day for the user's location. */
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

/**
 * Fetch the daily forecast for a single location (the user's residence).
 * Returns an empty array on any failure — never throws.
 */
export async function getForecast(lat: number, lng: number): Promise<ForecastDay[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max` +
      `&timezone=Asia%2FSeoul&forecast_days=${FORECAST_DAYS}`
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return []
    const data = (await res.json()) as { daily?: OpenMeteoDaily }
    const daily = data.daily
    const times = daily?.time
    const codes = daily?.weathercode
    const maxes = daily?.temperature_2m_max
    const mins = daily?.temperature_2m_min
    if (!times || !codes || !maxes || !mins) return []

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
    return days
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
