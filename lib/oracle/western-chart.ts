import * as Astronomy from 'astronomy-engine'
import { fromZonedTime } from 'date-fns-tz'
import { parse } from 'date-fns'

const SIGNS = [
  'Aries',
  'Taurus',
  'Gemini',
  'Cancer',
  'Leo',
  'Virgo',
  'Libra',
  'Scorpio',
  'Sagittarius',
  'Capricorn',
  'Aquarius',
  'Pisces',
] as const

export type WesternPlacement = (typeof SIGNS)[number]

function longitudeToSign(lonDeg: number): WesternPlacement {
  const x = ((lonDeg % 360) + 360) % 360
  return SIGNS[Math.floor(x / 30)]!
}

/** Julian Day fractional (UT). */
export function utcDateToJulianUt(dateUtc: Date): number {
  return dateUtc.getTime() / 86400000 + 2440587.5
}

function greenwichMeanSiderealDegrees(jdUt: number): number {
  const T = (jdUt - 2451545.0) / 36525
  let gm =
    280.46061837 +
    360.98564736629 * (jdUt - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000
  gm = ((gm % 360) + 360) % 360
  return gm
}

/** Ascendant ecliptic longitude (tropical). */
function ascendantLongitudeDeg(jdUt: number, latDeg: number, lonDegEast: number): number {
  const eps = Astronomy.DEG2RAD * 23.4392911111
  const phi = Astronomy.DEG2RAD * latDeg
  const lstDeg = greenwichMeanSiderealDegrees(jdUt) + lonDegEast
  const theta = Astronomy.DEG2RAD * (((lstDeg % 360) + 360) % 360)

  const yNum = Math.cos(theta)
  const yDen = -(Math.cos(eps) * Math.sin(phi) * Math.sin(theta) - Math.sin(eps) * Math.cos(phi))

  let lon = Math.atan2(yNum, yDen) * Astronomy.RAD2DEG
  lon = ((lon % 360) + 360) % 360
  return lon
}

/** Parse local calendar time in zone as absolute UTC (`Date`). */
export function localBirthInstantUtc(dobYmd: string, hhmm: string, ianaTz: string): Date {
  const ref = parse(`${dobYmd} ${hhmm}`, 'yyyy-MM-dd HH:mm', new Date(0))
  const zone = ianaTz && ianaTz.length > 2 ? ianaTz : 'UTC'
  return fromZonedTime(ref, zone)
}

export type WesternChartResult = {
  sunSign: WesternPlacement
  moonSign: WesternPlacement
  risingSign: WesternPlacement
  sunLongitudeDeg: number
  moonLongitudeDeg: number
  ascLongitudeDeg: number
  utcIso: string
  geocodeLabel?: string | null
  latitude: number
  longitude: number
}

export function computeWesternChart(params: {
  dobYmd: string
  timeHHMM: string
  latitude: number
  longitude: number
  timezone: string
  geocodeLabel?: string | null
}): WesternChartResult {
  const utc = localBirthInstantUtc(params.dobYmd, params.timeHHMM, params.timezone)

  const sunLon = Astronomy.SunPosition(utc).elon % 360
  const moonLon = Astronomy.EclipticLongitude(Astronomy.Body.Moon, utc) % 360
  const jdUt = utcDateToJulianUt(utc)
  const ascLon = ascendantLongitudeDeg(jdUt, params.latitude, params.longitude)

  return {
    sunSign: longitudeToSign(sunLon),
    moonSign: longitudeToSign(moonLon),
    risingSign: longitudeToSign(ascLon),
    sunLongitudeDeg: sunLon,
    moonLongitudeDeg: moonLon,
    ascLongitudeDeg: ascLon,
    utcIso: utc.toISOString(),
    geocodeLabel: params.geocodeLabel ?? null,
    latitude: params.latitude,
    longitude: params.longitude,
  }
}
