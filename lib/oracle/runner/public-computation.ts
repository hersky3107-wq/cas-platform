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
  'name',
  'name_local',
  'name_hanja',
  'name_latin',
])

function sanitizeCalculation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeCalculation)
  if (value === null || typeof value !== 'object') return value

  const clean: JsonObject = {}
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (PRIVATE_KEYS.has(key.toLowerCase())) continue
    clean[key] = sanitizeCalculation(child)
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
