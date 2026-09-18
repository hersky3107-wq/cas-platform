import type { OracleComputation } from '../schema'
import type { JsonObject } from './types'

const PRIVATE_KEYS = new Set([
  'date',
  'time',
  'timezone',
  'tz',
  'lat',
  'lng',
  'latitude',
  'longitude',
  'birthdate',
  'birth_date',
  'birthtime',
  'birth_time',
  'birthplace',
  'birth_place',
  // Do NOT strip generic `name`: 자미두수 palaces/stars and PRISM cycle
  // snapshots use that key for tradition labels (命, 武曲, Harvest), not PII.
  'name_local',
  'name_hanja',
  'name_latin',
  'fullname',
  'full_name',
  'givenname',
  'given_name',
  'latinname',
  'latin_name',
])

function isEclipticLongitudeKey(key: string, path: readonly string[]): boolean {
  // Geographic longitude is `lng` (already private). A key named
  // `longitude` under natal/transit `bodies` is ecliptic degrees 0–360 —
  // the natal wheel cannot place a planet without it. Session 18cd2c9c
  // stripped every `longitude` and the wheel unmounted.
  return key === 'longitude' && path.includes('bodies')
}

function sanitizeCalculation(value: unknown, path: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizeCalculation(entry, path))
  if (value === null || typeof value !== 'object') return value

  const clean: JsonObject = {}
  for (const [key, child] of Object.entries(value as JsonObject)) {
    const lower = key.toLowerCase()
    if (PRIVATE_KEYS.has(lower) && !isEclipticLongitudeKey(lower, path)) continue
    clean[key] = sanitizeCalculation(child, [...path, lower])
  }
  return clean
}

/**
 * Browser-safe engine output. The runner's AI payload remains server-only,
 * and obvious profile identity/location fields are recursively removed from
 * the calculation before it crosses the poll DTO boundary.
 */
export function publicComputation(row: OracleComputation) {
  return {
    system: row.system,
    engineVersion: row.engine_version,
    axes: row.axes,
    calculation: row.result ? sanitizeCalculation(row.result) as JsonObject : null,
    unreadable: row.result === null,
  }
}
