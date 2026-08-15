import { CLASSICAL_BODY_NAMES, SIGNS, type AstroBodyName } from './tables'
import type {
  AstroBodies,
  ChartShape,
  ElementBalance,
  ModalityBalance,
} from './types'
import { normalizeDegrees } from './math'

export function elementBalance(bodies: AstroBodies): ElementBalance {
  const result: ElementBalance = { fire: 0, earth: 0, air: 0, water: 0 }
  for (const body of Object.values(bodies)) {
    const sign = SIGNS.find((candidate) => candidate.name === body.sign)!
    result[sign.element]++
  }
  return result
}

export function modalityBalance(bodies: AstroBodies): ModalityBalance {
  const result: ModalityBalance = { cardinal: 0, fixed: 0, mutable: 0 }
  for (const body of Object.values(bodies)) {
    const sign = SIGNS.find((candidate) => candidate.name === body.sign)!
    result[sign.modality]++
  }
  return result
}

/**
 * Rough Jones-style distribution label over the ten classical planets.
 * Nodes are deliberately excluded because chart-shape systems traditionally
 * describe the planetary distribution.
 */
export function chartShape(bodies: AstroBodies): ChartShape | null {
  const longitudes = CLASSICAL_BODY_NAMES
    .map((name) => bodies[name].longitude)
    .sort((a, b) => a - b)
  if (longitudes.length < 6) return null

  const gaps = longitudes.map((longitude, index) => {
    const next = longitudes[(index + 1) % longitudes.length]!
    return normalizeDegrees(next - longitude)
  })
  const largestGap = Math.max(...gaps)
  const occupiedArc = 360 - largestGap

  if (occupiedArc <= 120) return 'BUNDLE'
  if (occupiedArc <= 180) return 'BOWL'
  if (largestGap >= 120) return 'LOCOMOTIVE'
  if (largestGap < 60) return 'SPLASH'
  return 'SPLAY'
}

export function withoutHouses(bodies: AstroBodies): AstroBodies {
  return Object.fromEntries(
    (Object.entries(bodies) as [AstroBodyName, AstroBodies[AstroBodyName]][]).map(
      ([name, body]) => [name, { ...body, house: null }],
    ),
  ) as AstroBodies
}
