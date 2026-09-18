import type { OracleComputation } from '../schema'
import type { JsonObject } from './types'

/**
 * Exact profile PII keys that must never reach the browser client.
 * Matched case-insensitively on the key name anywhere in the tree.
 */
const FORBIDDEN_PII_KEYS = new Set([
  'birthdate',
  'birth_date',
  'dateofbirth',
  'date_of_birth',
  'dob',
  'birthtime',
  'birth_time',
  'birthplace',
  'birth_place',
  'birthcity',
  'birth_city',
  'city',
  'place',
  'address',
  'name_local',
  'name_hanja',
  'name_latin',
  'fullname',
  'full_name',
  'givenname',
  'given_name',
  'latinname',
  'latin_name',
  'surname',
  'email',
  'phone',
  'lat',
  'latitude',
  'lng',
  'lon',
  'longitude',
  'tz',
  'timezone',
  'ai_payload',
  'prompt',
  'model',
])

/**
 * Top-level allowed keys for each of the 12 oracle engines.
 * Any unlisted top-level key added to `result` (e.g. `raw_profile`, `geo`, `user_input`)
 * is rejected at the root before entering the object.
 */
const SYSTEM_ALLOWED_ROOT_KEYS: Record<string, readonly string[]> = {
  saju: ['pillars', 'fiveElements', 'tenGods', 'eokbu', 'greatLuck', 'iljin'],
  astro: ['natal', 'transits'],
  prism: ['prism', 'mbti', 'colors'],
  ziwei: ['chart'],
  numerology: ['numbers'],
  name: ['reading', 'subject'],
  iching: ['draw'],
  tarot: ['draw'],
  runes: ['draw'],
  ninestar: ['natal', 'current'],
  sukuyou: ['natal', 'current', 'sukuyouRelation'],
  tzolkin: ['natal', 'current'],
}

/**
 * Path-aware rule for `longitude`:
 * Ecliptic longitude (0..360 degrees on celestial bodies in astronomy/astro)
 * is permitted ONLY under `bodies` or `planets`.
 * Geographic longitude (`nested.longitude`, `geo.longitude`, root `longitude`)
 * is stripped because it is geographic coordinate PII.
 */
function isEclipticLongitude(key: string, path: readonly string[]): boolean {
  if (key !== 'longitude') return false
  const parent = path[path.length - 1]
  const grandparent = path[path.length - 2]
  return parent === 'bodies' || grandparent === 'bodies' || parent === 'planets' || grandparent === 'planets'
}

/**
 * Path-aware rule for bare `date` or `time`:
 * Strips bare `date` / `time` when used as input profile timestamps (e.g. root `date`, `time`).
 * Does NOT strip computed date structures like `instantUtc`, `atUtc`, `lunarYear`, `year`, `month`, `day`, `startYear`, etc.
 */
function isForbiddenKey(key: string, path: readonly string[]): boolean {
  const lower = key.toLowerCase()

  // 1. Ecliptic longitude under bodies is valid computed astrological data
  if (isEclipticLongitude(lower, path)) {
    return false
  }

  // 2. Exact PII keys (birthdate, latitude, geo longitude, tz, personal name fields, etc.)
  if (FORBIDDEN_PII_KEYS.has(lower)) {
    return true
  }

  // 3. Bare `date` or `time` outside known computed timestamp fields
  if (lower === 'date' || lower === 'time') {
    return true
  }

  return false
}

function sanitizeValue(value: unknown, path: readonly string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, path))
  }
  if (value === null || typeof value !== 'object') {
    return value
  }

  const clean: JsonObject = {}
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (isForbiddenKey(key, path)) continue
    clean[key] = sanitizeValue(child, [...path, key.toLowerCase()])
  }
  return clean
}

/**
 * Sanitizes a system calculation using:
 * 1. Root allowlist per engine system (drops unexpected injected root fields like profile or raw coordinates).
 * 2. Deep recursive path-aware PII scrubbing (drops all coordinates, profile birth dates/times/places/names).
 */
export function sanitizeCalculation(result: unknown, system?: string): JsonObject | null {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return null

  const allowedRootKeys = system ? SYSTEM_ALLOWED_ROOT_KEYS[system] : undefined
  const source = result as JsonObject
  const filteredRoot: JsonObject = {}

  if (allowedRootKeys) {
    for (const key of allowedRootKeys) {
      if (key in source) {
        filteredRoot[key] = source[key]
      }
    }
  } else {
    Object.assign(filteredRoot, source)
  }

  return sanitizeValue(filteredRoot) as JsonObject
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
    calculation: row.result ? sanitizeCalculation(row.result, row.system) : null,
    unreadable: row.result === null,
  }
}
