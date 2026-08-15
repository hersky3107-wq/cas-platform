import * as Astronomy from 'astronomy-engine'
import {
  ASTRONOMY_BODY_BY_NAME,
  CLASSICAL_BODY_NAMES,
  SIGNS,
  type AstroBodyName,
} from './tables'
import type { AstroBodies, AstroBodyPosition } from './types'
import { DAY_MS, normalizeDegrees, signedAngularDelta } from './math'

const SPEED_SAMPLE_HALF_DAYS = 0.25

function classicalLongitude(name: (typeof CLASSICAL_BODY_NAMES)[number], instant: Date): number {
  const vector = Astronomy.GeoVector(ASTRONOMY_BODY_BY_NAME[name], instant, true)
  return normalizeDegrees(Astronomy.Ecliptic(vector).elon)
}

/**
 * True (oscillating) lunar node: ascending node of the Moon's instantaneous
 * geocentric orbital plane, expressed in true ecliptic-of-date coordinates.
 */
function trueNodeLongitude(instant: Date): number {
  const stateEqj = Astronomy.GeoMoonState(instant)
  const stateEct = Astronomy.RotateState(Astronomy.Rotation_EQJ_ECT(instant), stateEqj)
  const hx = stateEct.y * stateEct.vz - stateEct.z * stateEct.vy
  const hy = stateEct.z * stateEct.vx - stateEct.x * stateEct.vz
  return normalizeDegrees(Math.atan2(hx, -hy) * Astronomy.RAD2DEG)
}

function centeredSpeed(longitudeAt: (date: Date) => number, instant: Date): number {
  const offset = SPEED_SAMPLE_HALF_DAYS * DAY_MS
  const before = longitudeAt(new Date(instant.getTime() - offset))
  const after = longitudeAt(new Date(instant.getTime() + offset))
  return signedAngularDelta(after, before) / (2 * SPEED_SAMPLE_HALF_DAYS)
}

function position(longitude: number, speed: number, house: number | null): AstroBodyPosition {
  const signIndex = Math.floor(normalizeDegrees(longitude) / 30)
  return {
    longitude: normalizeDegrees(longitude),
    sign: SIGNS[signIndex]!.name,
    degreeInSign: normalizeDegrees(longitude) % 30,
    speed,
    retrograde: speed < 0,
    house,
  }
}

export function calculateBodies(
  instant: Date,
  timeKnown: boolean,
  houseForLongitude: (longitude: number) => number | null,
): AstroBodies {
  const entries: [AstroBodyName, AstroBodyPosition][] = CLASSICAL_BODY_NAMES.map((name) => {
    const longitudeAt = (date: Date) => classicalLongitude(name, date)
    const longitude = longitudeAt(instant)
    const speed = centeredSpeed(longitudeAt, instant)
    const value = position(longitude, speed, houseForLongitude(longitude))
    if (name === 'Moon' && !timeKnown) {
      // Full local-day span, centered on the local-noon placeholder instant.
      value.uncertaintyDegrees = Math.abs(speed)
    }
    return [name, value]
  })

  const nodeSpeed = centeredSpeed(trueNodeLongitude, instant)
  const north = trueNodeLongitude(instant)
  const south = normalizeDegrees(north + 180)
  entries.push(
    ['TrueNode', position(north, nodeSpeed, houseForLongitude(north))],
    ['SouthNode', position(south, nodeSpeed, houseForLongitude(south))],
  )

  return Object.fromEntries(entries) as AstroBodies
}
