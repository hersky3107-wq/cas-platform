/**
 * Per-system input inventory for the 12-system reading page.
 *
 * Honour the engine: do not ask every system for every field. Profile fields
 * live on oracle_profiles / the birth sketch. Per-reading state (tarot picks,
 * rune count, PRISM colours) lives on session_inputs.
 */
import { SYSTEM_IDS, type SystemId } from './axes/types'
import { SINGLE_SYSTEM_BY_ID, type SingleSystemId } from './single-system-ui'

export const READING_SYSTEM_IDS = SYSTEM_IDS

export function isReadingSystemId(value: string): value is SystemId {
  return (SYSTEM_IDS as readonly string[]).includes(value)
}

/** Canonical URL for a single-system reading. Fate stays the saju alias. */
export function readingPath(system: SystemId): string {
  return system === 'saju' ? '/modes/oracle/fate' : `/modes/oracle/read/${system}`
}

/** In-flight session key. Fate and /read/saju share one key so a reload resumes. */
export function readingStorageKey(system: SystemId): string {
  return system === 'saju' ? 'oracle.fate.active-session' : `oracle.read.${system}.active-session`
}

export function profilePathForSystem(system: SystemId, missing: readonly ProfileField[]): string {
  const params = new URLSearchParams()
  params.set('system', system)
  params.set('return', readingPath(system))
  if (missing.length > 0) params.set('missing', missing.join(','))
  return `/modes/oracle/profile?${params.toString()}`
}

/**
 * Identity fields the profile may hold. Session-only inputs are not listed
 * here — those are collected on the reading page.
 */
export const PROFILE_FIELDS = [
  'birth_date',
  'sex',
  'birth_place',
  'name',
  'name_latin',
  'mbti',
] as const
export type ProfileField = (typeof PROFILE_FIELDS)[number]

export type ProfileSnapshot = {
  birth_date?: string | null
  sex?: string | null
  gender?: string | null
  birth_place?: string | null
  birth_city?: string | null
  lat?: number | null
  lng?: number | null
  name_local?: string | null
  name_hanja?: string | null
  name_latin?: string | null
  mbti?: string | null
  /** Runner row exists. Draw-based systems only need this (or a stub). */
  subjectProfileId?: string | null
  /** True when the runner row is an FK stub with no real birth sketch. */
  placeholderBirthDate?: boolean
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasDate(snapshot: ProfileSnapshot): boolean {
  if (snapshot.placeholderBirthDate) return false
  return hasText(snapshot.birth_date)
}

function hasName(snapshot: ProfileSnapshot): boolean {
  if (hasText(snapshot.name_local) && snapshot.name_local!.trim().length >= 2) return true
  if (hasText(snapshot.name_hanja) && snapshot.name_hanja!.trim().length >= 2) return true
  if (hasText(snapshot.name_latin) && snapshot.name_latin!.trim().split(/\s+/).length >= 2) {
    return true
  }
  return false
}

function hasSexChoice(snapshot: ProfileSnapshot): boolean {
  if (snapshot.sex === 'M' || snapshot.sex === 'F') return true
  if (snapshot.gender === 'male' || snapshot.gender === 'female' || snapshot.gender === 'prefer_not_to_say') {
    return true
  }
  return false
}

function hasPlace(snapshot: ProfileSnapshot): boolean {
  return hasText(snapshot.birth_place) || hasText(snapshot.birth_city)
}

function hasMbti(snapshot: ProfileSnapshot): boolean {
  return hasText(snapshot.mbti)
}

function hasLatinName(snapshot: ProfileSnapshot): boolean {
  return hasText(snapshot.name_latin)
}

/**
 * Required profile fields per system. Optional extras (numerology Latin name)
 * are listed separately so the page never blocks on them.
 */
export function requiredProfileFields(system: SystemId): readonly ProfileField[] {
  switch (system) {
    case 'tarot':
    case 'runes':
    case 'iching':
      return []
    case 'tzolkin':
    case 'ninestar':
    case 'sukuyou':
      return ['birth_date']
    case 'numerology':
      return ['birth_date']
    case 'name':
      return ['name']
    case 'prism':
      return ['birth_date', 'mbti']
    case 'saju':
    case 'ziwei':
      return ['birth_date', 'sex']
    case 'astro':
      return ['birth_date', 'birth_place']
  }
}

export function optionalProfileFields(system: SystemId): readonly ProfileField[] {
  if (system === 'numerology') return ['name_latin']
  return []
}

export function isDrawBasedSystem(system: SystemId): boolean {
  return system === 'tarot' || system === 'runes' || system === 'iching'
}

export function needsSubjectProfile(system: SystemId): boolean {
  // Every session row FKs a profile. Draw-based systems may use a stub.
  void system
  return true
}

export function fieldMissing(field: ProfileField, snapshot: ProfileSnapshot): boolean {
  switch (field) {
    case 'birth_date':
      return !hasDate(snapshot)
    case 'sex':
      return !hasSexChoice(snapshot)
    case 'birth_place':
      return !hasPlace(snapshot)
    case 'name':
      return !hasName(snapshot)
    case 'name_latin':
      return !hasLatinName(snapshot)
    case 'mbti':
      return !hasMbti(snapshot)
  }
}

export function missingRequiredFields(system: SystemId, snapshot: ProfileSnapshot): ProfileField[] {
  return requiredProfileFields(system).filter((field) => fieldMissing(field, snapshot))
}

export function parseMissingParam(raw: string | null | undefined): ProfileField[] {
  if (!raw) return []
  const allowed = new Set<string>(PROFILE_FIELDS)
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is ProfileField => allowed.has(entry))
}

/**
 * Fields the profile form should render.
 * `full` is the unparameterized lobby sketch (date, city, gender, time).
 * A missing= query shows only those fields so held values are never re-asked.
 */
export function profileFieldsToShow(
  system: SystemId | null,
  missing: readonly ProfileField[],
): 'full' | ProfileField[] {
  if (missing.length > 0) return [...missing]
  if (!system) return 'full'
  return [...requiredProfileFields(system), ...optionalProfileFields(system)]
}

export const PROFILE_FIELD_REASON: Record<ProfileField, { ko: string; en: string }> = {
  birth_date: {
    ko: '이 체계는 생년월일이 필요합니다.',
    en: 'This system needs a date of birth.',
  },
  sex: {
    ko: '사주 대운·자미 대한 방향에 성별이 쓰입니다. 밝히고 싶지 않으면 ‘응답하지 않음’을 고르면 됩니다.',
    en: 'Sex is used only for saju 대운 and ziwei 대한 direction. Choose “prefer not to say” to skip.',
  },
  birth_place: {
    ko: '점성술은 출생 도시로 좌표를 잡습니다. 서울로 임의 지정하지 않습니다.',
    en: 'Astrology geocodes the birth city. It will not silently assume Seoul.',
  },
  name: {
    ko: '성명학은 성·이름·로케일이 필요합니다.',
    en: 'Name reading needs a surname, given name, and locale.',
  },
  name_latin: {
    ko: '수비학 이름 수는 로마자 이름이 있으면 더해집니다. 없어도 생년월일만으로 읽습니다.',
    en: 'Numerology can add a name number from a Latin name. Date-only still works.',
  },
  mbti: {
    ko: 'PRISM은 프로필에 저장된 MBTI를 씁니다.',
    en: 'PRISM reads MBTI from the saved profile.',
  },
}

export function systemCopy(system: SingleSystemId) {
  return SINGLE_SYSTEM_BY_ID[system]
}
