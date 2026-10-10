/**
 * Stull (2011) wet-bulb temperature. Temperature in °C, relative humidity in percent.
 * The arctangents are in radians, which is what Math.atan returns.
 */
export function wetBulbC(tempC: number, rhPct: number): number {
  const rh = Math.min(100, Math.max(0, rhPct))
  return (
    tempC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tempC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) -
    4.686035
  )
}

/**
 * Environment Canada wind chill, valid at or below 10°C with wind of at least 5 km/h.
 * Returns null outside that range. Wind input is metres per second.
 */
export function windChillC(tempC: number, windMs: number): number | null {
  const kmh = windMs * 3.6
  if (tempC > 10 || kmh < 5) return null
  return 13.12 + 0.6215 * tempC - 11.37 * kmh ** 0.16 + 0.3965 * tempC * kmh ** 0.16
}

/** Larger cities keep the full meteorological value. A missing population keeps a partial weight. */
export function populationWeight(pop: number): number {
  if (!Number.isFinite(pop) || pop <= 0) return 0.45
  return Math.min(1, 0.45 + 0.55 * (Math.min(pop, 1_000_000) / 1_000_000))
}
