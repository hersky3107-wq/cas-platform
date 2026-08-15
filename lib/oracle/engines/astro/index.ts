import { PLACIDUS_LATITUDE_LIMIT, POLAR_HOUSE_FALLBACK, DEFAULT_HOUSE_SYSTEM } from './conventions'
import { calculateBodies } from './ephemeris'
import { calculateAngles, calculateHouses, houseForLongitude } from './houses'
import { natalAspects, crossAspects } from './aspects'
import { chartShape, elementBalance, modalityBalance } from './derived'
import { resolveInstant } from './math'
import type {
  AstroDateTime,
  NatalChart,
  NatalChartInput,
  SynastryResult,
  TransitResult,
} from './types'

export function natalChart(input: NatalChartInput): NatalChart {
  const instant = resolveInstant(input, input.timeKnown)
  const defaultSystem =
    Math.abs(input.lat) > PLACIDUS_LATITUDE_LIMIT ? POLAR_HOUSE_FALLBACK : DEFAULT_HOUSE_SYSTEM

  if (!input.timeKnown) {
    const bodies = calculateBodies(instant, false, () => null)
    return {
      instantUtc: instant.toISOString(),
      timeKnown: false,
      bodies,
      angles: null,
      houses: null,
      houseSystemUsed: defaultSystem,
      aspects: natalAspects(bodies),
      elementBalance: elementBalance(bodies),
      modalityBalance: modalityBalance(bodies),
      chartShape: chartShape(bodies),
      limitations: ['no_houses', 'no_angles', 'moon_approximate'],
    }
  }

  const angles = calculateAngles(instant, input.lat, input.lng)
  const { cusps, system } = calculateHouses(instant, input.lat, input.lng, angles)
  const bodies = calculateBodies(instant, true, (longitude) => houseForLongitude(longitude, cusps))

  return {
    instantUtc: instant.toISOString(),
    timeKnown: true,
    bodies,
    angles,
    houses: cusps,
    houseSystemUsed: system,
    aspects: natalAspects(bodies),
    elementBalance: elementBalance(bodies),
    modalityBalance: modalityBalance(bodies),
    chartShape: chartShape(bodies),
    limitations: [],
  }
}

export function transits(input: { natal: NatalChart; at: AstroDateTime }): TransitResult {
  const instant = resolveInstant(input.at, true)
  const bodies = calculateBodies(instant, true, () => null)
  return {
    atUtc: instant.toISOString(),
    bodies,
    aspects: crossAspects(bodies, input.natal.bodies, { a: 'transit', b: 'natal' }),
  }
}

export function synastry(input: { chartA: NatalChart; chartB: NatalChart }): SynastryResult {
  return {
    aspects: crossAspects(input.chartA.bodies, input.chartB.bodies, { a: 'A', b: 'B' }),
  }
}

export {
  ASTRO_ENGINE_VERSION,
  ZODIAC,
  DEFAULT_HOUSE_SYSTEM,
  POLAR_HOUSE_FALLBACK,
  PLACIDUS_LATITUDE_LIMIT,
  ASPECT_ORBS,
} from './conventions'
export type { AspectType, HouseSystem, ZodiacConvention } from './conventions'

export {
  SIGNS,
  ASPECT_DEFINITIONS,
  RULERSHIPS,
  CLASSICAL_BODY_NAMES,
} from './tables'
export type {
  AstroBodyName,
  ClassicalBodyName,
  Element,
  Modality,
  SignName,
} from './tables'

export type {
  AstroDateTime,
  NatalChartInput,
  AstroBodyPosition,
  AstroBodies,
  ChartAngles,
  Aspect,
  CrossAspect,
  ElementBalance,
  ModalityBalance,
  ChartShape,
  NatalChart,
  TransitResult,
  SynastryResult,
} from './types'
