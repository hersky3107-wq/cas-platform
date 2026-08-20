/**
 * The ai_payload privacy rule.
 *
 * Nothing sent to an AI may carry the subject's birth date, birth time,
 * birth place, or name — nor the coordinates or timezone those resolve to.
 * The payload builder in payload.ts works from an ALLOWLIST (computed
 * vectors and machine codes only); this module is the gate that proves it.
 *
 * `assertNoPersonalData` runs on every payload before it leaves the process,
 * so a future contributor who adds a field carrying raw profile data gets a
 * failed session instead of a leak. It fails closed on purpose.
 */

/** The raw profile facts that must never reach a provider. */
export type PersonalData = {
  /** YYYY-MM-DD */
  birthDate: string
  /** HH:mm or HH:mm:ss */
  birthTime: string | null
  birthPlace: string | null
  /** Every name form on the profile: local, hanja, latin, and their parts. */
  names: string[]
  lat: number | null
  lng: number | null
  timezone: string | null
}

/**
 * Keys that may never appear in a payload, matched on the exact lowercased
 * key. An exact-match set is used rather than a substring regex because
 * substrings produce false positives on legitimate computed keys — 'lat'
 * appears inside 'relation', 'tz' inside 'tzolkin'.
 */
const FORBIDDEN_KEYS = new Set([
  'birthdate',
  'birth_date',
  'birthtime',
  'birth_time',
  'dateofbirth',
  'date_of_birth',
  'dob',
  'birthplace',
  'birth_place',
  'birthcity',
  'birth_city',
  'city',
  'place',
  'address',
  'name',
  'fullname',
  'full_name',
  'namelocal',
  'name_local',
  'namehanja',
  'name_hanja',
  'namelatin',
  'name_latin',
  'latinname',
  'latin_name',
  'surname',
  'givenname',
  'given_name',
  'lat',
  'latitude',
  'lng',
  'lon',
  'longitude',
  'tz',
  'timezone',
  'sex',
  'gender',
  'email',
  'phone',
])

export class OraclePrivacyError extends Error {
  readonly path: string
  readonly rule: 'forbidden_key' | 'personal_value'

  constructor(rule: 'forbidden_key' | 'personal_value', path: string, detail: string) {
    super(`ai_payload privacy violation at ${path}: ${detail}`)
    this.name = 'OraclePrivacyError'
    this.rule = rule
    this.path = path
  }
}

/**
 * Literals we search for inside string leaves.
 *
 * Single-character name parts (a one-syllable Korean surname) are compared by
 * equality only — hunting for them as substrings would flag unrelated CJK
 * output from the 자미두수 and 성명학 tables. ASCII needles that begin and end
 * on a word character are matched at word boundaries, so a surname does not
 * fire on every word that happens to contain it.
 */
type Needle = {
  text: string
  test: (lowered: string) => boolean
  /**
   * Pure ASCII letters — the romanized-name class. These are the only
   * needles that can collide with a projector's romanized code vocabulary,
   * so they are the only ones exempted inside machine-code fields.
   */
  alphabeticAscii: boolean
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildNeedles(pii: PersonalData): Needle[] {
  const needles: Needle[] = []
  const seen = new Set<string>()

  const push = (raw: string | null | undefined): void => {
    if (typeof raw !== 'string') return
    const value = raw.trim().toLowerCase()
    if (value.length === 0 || seen.has(value)) return
    seen.add(value)

    const alphabeticAscii = /^[a-z]+(?:[ '-][a-z]+)*$/.test(value)

    if (value.length === 1) {
      needles.push({ text: value, test: (lowered) => lowered === value, alphabeticAscii })
      return
    }
    if (/^[a-z0-9].*[a-z0-9]$/.test(value)) {
      const pattern = new RegExp(`\\b${escapeRegExp(value)}\\b`)
      needles.push({ text: value, test: (lowered) => pattern.test(lowered), alphabeticAscii })
      return
    }
    needles.push({ text: value, test: (lowered) => lowered.includes(value), alphabeticAscii })
  }

  push(pii.birthDate)
  push(pii.birthTime)
  // A 'HH:mm:ss' birth time also leaks as 'HH:mm'.
  if (pii.birthTime && pii.birthTime.length > 5) push(pii.birthTime.slice(0, 5))
  push(pii.birthPlace)
  push(pii.timezone)
  for (const name of pii.names) push(name)

  return needles
}

function checkString(value: string, path: string, needles: readonly Needle[], skipRomanized: boolean): void {
  const lowered = value.toLowerCase()
  for (const needle of needles) {
    if (skipRomanized && needle.alphabeticAscii) continue
    if (needle.test(lowered)) {
      throw new OraclePrivacyError('personal_value', path, `contains personal value "${needle.text}"`)
    }
  }
}

function checkNumber(value: number, path: string, pii: PersonalData): void {
  for (const coord of [pii.lat, pii.lng]) {
    if (coord !== null && Number.isFinite(coord) && value === coord) {
      throw new OraclePrivacyError('personal_value', path, `equals birth coordinate ${coord}`)
    }
  }
}

export type PrivacyScanOptions = {
  label?: string
  /**
   * Top-level fields whose string leaves are machine codes drawn from the
   * projectors' static tables, never from the profile — `reasons` and
   * `unreadable`, per the contract in axes/types.ts ("Projectors NEVER emit
   * Korean/English prose").
   *
   * Inside these fields, and ONLY inside them, romanized-name needles are
   * skipped. They have to be: the code vocabulary romanizes CJK terms and
   * collides with romanized names — the Maya nawal `Kʼimʼ` reduces to
   * `maya.nawal.kim`, which is also one of the most common Korean surnames,
   * so scanning it here would fail every session belonging to a 김.
   *
   * Keys, coordinates, dates, times, timezones, and CJK names are still
   * checked here exactly as everywhere else.
   */
  machineCodeFields?: readonly string[]
}

type ScanState = {
  pii: PersonalData
  needles: Needle[]
  machineCodeFields: ReadonlySet<string>
}

function walk(value: unknown, path: string, depth: number, root: string | null, state: ScanState): void {
  if (value === null || value === undefined) return

  const inMachineCodeField = root !== null && state.machineCodeFields.has(root)

  if (typeof value === 'string') {
    checkString(value, path, state.needles, inMachineCodeField)
    return
  }
  if (typeof value === 'number') {
    checkNumber(value, path, state.pii)
    return
  }
  if (typeof value === 'boolean') return
  if (Array.isArray(value)) {
    value.forEach((entry, i) => walk(entry, `${path}[${i}]`, depth + 1, root, state))
    return
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        throw new OraclePrivacyError('forbidden_key', `${path}.${key}`, `key "${key}" is never allowed in an ai_payload`)
      }
      walk(child, `${path}.${key}`, depth + 1, depth === 0 ? key : root, state)
    }
  }
}

/**
 * Throws OraclePrivacyError if `payload` carries any personal data, by key
 * name or by value. Call this on every payload before it reaches an adapter.
 */
export function assertNoPersonalData(
  payload: unknown,
  pii: PersonalData,
  options: PrivacyScanOptions | string = {},
): void {
  const opts: PrivacyScanOptions = typeof options === 'string' ? { label: options } : options
  walk(payload, opts.label ?? 'payload', 0, null, {
    pii,
    needles: buildNeedles(pii),
    machineCodeFields: new Set(opts.machineCodeFields ?? []),
  })
}

/** True when the payload is clean. Wraps the assertion for callers that branch. */
export function isFreeOfPersonalData(
  payload: unknown,
  pii: PersonalData,
  options: PrivacyScanOptions | string = {},
): boolean {
  try {
    assertNoPersonalData(payload, pii, options)
    return true
  } catch (e) {
    if (e instanceof OraclePrivacyError) return false
    throw e
  }
}

/**
 * Shape of a projector code: lowercase ASCII plus dots, colons, hyphens, and
 * underscores, with hanja/hangul allowed because the 28-mansion and 오행 codes
 * carry them (`sukuyou.phase.sanku_危`). No whitespace, so no prose can pass.
 */
export const MACHINE_CODE_PATTERN = /^[a-z0-9][a-z0-9_.:\-\u3130-\u318F\uAC00-\uD7A3\u3400-\u9FFF]*$/
