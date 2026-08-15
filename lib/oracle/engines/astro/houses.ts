import * as Astronomy from 'astronomy-engine'
import {
  PLACIDUS_LATITUDE_LIMIT,
  POLAR_HOUSE_FALLBACK,
  DEFAULT_HOUSE_SYSTEM,
  type HouseSystem,
} from './conventions'
import type { ChartAngles } from './types'
import { DEG, RAD, meanObliquityDegrees, normalizeDegrees } from './math'

const ITERATIONS = 40

function eclipticLongitudeFromRightAscension(raDegrees: number, obliquity: number): number {
  const ra = raDegrees * DEG
  const eps = obliquity * DEG
  return normalizeDegrees(Math.atan2(Math.sin(ra), Math.cos(ra) * Math.cos(eps)) * RAD)
}

export function calculateAngles(instant: Date, latitude: number, longitude: number): ChartAngles {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError(`Latitude must be within -90..90: ${latitude}`)
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError(`Longitude must be within -180..180: ${longitude}`)
  }

  const eps = meanObliquityDegrees(instant) * DEG
  const phi = latitude * DEG
  const localSidereal = normalizeDegrees(Astronomy.SiderealTime(instant) * 15 + longitude)
  const theta = localSidereal * DEG

  const midheaven = eclipticLongitudeFromRightAscension(localSidereal, eps * RAD)
  const ascendant = normalizeDegrees(
    Math.atan2(
      Math.cos(theta),
      -(Math.sin(theta) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps)),
    ) * RAD,
  )

  return {
    ascendant,
    midheaven,
    descendant: normalizeDegrees(ascendant + 180),
    imumCoeli: normalizeDegrees(midheaven + 180),
  }
}

/**
 * Solves one intermediate Placidus cusp by fixed-point iteration.
 *
 * Placidus trisects the semi-diurnal and semi-nocturnal arcs. For each
 * candidate ecliptic longitude, its declination determines its rising/setting
 * hour angle H0 = acos(-tan(phi) tan(delta)). That H0 updates the target right
 * ascension; converting RA back to ecliptic longitude closes the iteration.
 */
function placidusIntermediate(
  localSidereal: number,
  latitude: number,
  obliquity: number,
  direction: 1 | -1,
  fraction: number,
): number {
  const phi = latitude * DEG
  const eps = obliquity * DEG
  let longitude = eclipticLongitudeFromRightAscension(
    localSidereal + direction * 90 * fraction,
    obliquity,
  )

  for (let i = 0; i < ITERATIONS; i++) {
    const declination = Math.asin(Math.sin(eps) * Math.sin(longitude * DEG))
    const cosineHourAngle = -Math.tan(phi) * Math.tan(declination)
    if (cosineHourAngle < -1 || cosineHourAngle > 1) {
      throw new RangeError('Placidus cusp is undefined at this latitude')
    }
    const semiArc = Math.acos(cosineHourAngle) * RAD
    longitude = eclipticLongitudeFromRightAscension(
      localSidereal + direction * semiArc * fraction,
      obliquity,
    )
  }
  return longitude
}

function wholeSignCusps(ascendant: number): number[] {
  const first = Math.floor(normalizeDegrees(ascendant) / 30) * 30
  return Array.from({ length: 12 }, (_, index) => normalizeDegrees(first + index * 30))
}

function placidusCusps(
  instant: Date,
  latitude: number,
  longitude: number,
  angles: ChartAngles,
): number[] {
  const obliquity = meanObliquityDegrees(instant)
  const localSidereal = normalizeDegrees(Astronomy.SiderealTime(instant) * 15 + longitude)
  const cusp11 = placidusIntermediate(localSidereal, latitude, obliquity, 1, 1 / 3)
  const cusp12 = placidusIntermediate(localSidereal, latitude, obliquity, 1, 2 / 3)
  const cusp9 = placidusIntermediate(localSidereal, latitude, obliquity, -1, 1 / 3)
  const cusp8 = placidusIntermediate(localSidereal, latitude, obliquity, -1, 2 / 3)

  return [
    angles.ascendant,
    normalizeDegrees(cusp8 + 180),
    normalizeDegrees(cusp9 + 180),
    angles.imumCoeli,
    normalizeDegrees(cusp11 + 180),
    normalizeDegrees(cusp12 + 180),
    angles.descendant,
    cusp8,
    cusp9,
    angles.midheaven,
    cusp11,
    cusp12,
  ]
}

export function calculateHouses(
  instant: Date,
  latitude: number,
  longitude: number,
  angles: ChartAngles,
): { cusps: number[]; system: HouseSystem } {
  if (Math.abs(latitude) > PLACIDUS_LATITUDE_LIMIT) {
    return { cusps: wholeSignCusps(angles.ascendant), system: POLAR_HOUSE_FALLBACK }
  }
  try {
    const cusps = placidusCusps(instant, latitude, longitude, angles)
    if (cusps.some((cusp) => !Number.isFinite(cusp))) throw new RangeError('Non-finite cusp')
    return { cusps, system: DEFAULT_HOUSE_SYSTEM }
  } catch {
    // A numerical undefined condition is treated like the polar case.
    return { cusps: wholeSignCusps(angles.ascendant), system: POLAR_HOUSE_FALLBACK }
  }
}

export function houseForLongitude(longitude: number, cusps: number[]): number | null {
  if (cusps.length !== 12) return null
  for (let index = 0; index < 12; index++) {
    const start = cusps[index]!
    const end = cusps[(index + 1) % 12]!
    const span = normalizeDegrees(end - start)
    const offset = normalizeDegrees(longitude - start)
    if (offset < span) return index + 1
  }
  return null
}
