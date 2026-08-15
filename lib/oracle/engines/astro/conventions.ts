/** Fixed, versioned conventions for the pure astrology engine. */

export const ASTRO_ENGINE_VERSION = '1.0.0'

export const ZODIAC = 'TROPICAL' as const
export const DEFAULT_HOUSE_SYSTEM = 'PLACIDUS' as const
export const POLAR_HOUSE_FALLBACK = 'WHOLE_SIGN' as const
export const PLACIDUS_LATITUDE_LIMIT = 66.5

export const ASPECT_ORBS = {
  conjunction: 8,
  opposition: 8,
  trine: 7,
  square: 7,
  sextile: 5,
} as const

export type ZodiacConvention = typeof ZODIAC
export type HouseSystem = typeof DEFAULT_HOUSE_SYSTEM | typeof POLAR_HOUSE_FALLBACK
export type AspectType = keyof typeof ASPECT_ORBS
