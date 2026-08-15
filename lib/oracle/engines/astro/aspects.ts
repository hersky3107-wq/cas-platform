import { ASPECT_ORBS } from './conventions'
import { ASPECT_DEFINITIONS, type AstroBodyName } from './tables'
import type { Aspect, AstroBodies, AstroBodyPosition, CrossAspect } from './types'
import { angularSeparation, normalizeDegrees } from './math'

const APPLYING_PROJECTION_DAYS = 0.01

function matchAspect(
  aName: AstroBodyName,
  a: AstroBodyPosition,
  bName: AstroBodyName,
  b: AstroBodyPosition,
): Aspect | null {
  const separation = angularSeparation(a.longitude, b.longitude)

  for (const definition of ASPECT_DEFINITIONS) {
    const orb = Math.abs(separation - definition.exactDegrees)
    if (orb > ASPECT_ORBS[definition.type]) continue

    const futureA = normalizeDegrees(a.longitude + a.speed * APPLYING_PROJECTION_DAYS)
    const futureB = normalizeDegrees(b.longitude + b.speed * APPLYING_PROJECTION_DAYS)
    const futureSeparation = angularSeparation(futureA, futureB)
    const futureOrb = Math.abs(futureSeparation - definition.exactDegrees)

    return {
      a: aName,
      b: bName,
      type: definition.type,
      exactDegrees: definition.exactDegrees,
      orb,
      applying: futureOrb < orb,
    }
  }
  return null
}

export function natalAspects(bodies: AstroBodies): Aspect[] {
  const entries = Object.entries(bodies) as [AstroBodyName, AstroBodyPosition][]
  const aspects: Aspect[] = []
  for (let a = 0; a < entries.length; a++) {
    for (let b = a + 1; b < entries.length; b++) {
      const found = matchAspect(entries[a]![0], entries[a]![1], entries[b]![0], entries[b]![1])
      if (found) aspects.push(found)
    }
  }
  return aspects.sort((left, right) => left.orb - right.orb)
}

export function crossAspects(
  sideA: AstroBodies,
  sideB: AstroBodies,
  labels: { a: 'transit' | 'A'; b: 'natal' | 'B' },
): CrossAspect[] {
  const aEntries = Object.entries(sideA) as [AstroBodyName, AstroBodyPosition][]
  const bEntries = Object.entries(sideB) as [AstroBodyName, AstroBodyPosition][]
  const aspects: CrossAspect[] = []

  for (const [aName, a] of aEntries) {
    for (const [bName, b] of bEntries) {
      const found = matchAspect(aName, a, bName, b)
      if (found) aspects.push({ ...found, aSide: labels.a, bSide: labels.b })
    }
  }
  return aspects.sort((left, right) => left.orb - right.orb)
}

/** Testable pure primitive; intentionally not re-exported from the public barrel. */
export const __testing = { matchAspect }
