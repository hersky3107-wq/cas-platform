/**
 * System id -> human display name.
 *
 * `oracle_sessions.oracle_type` stores the machine id ('saju'), which is also
 * what the share page reads. The stored value must stay an id so old rows and
 * new rows compare, so the label is resolved at render instead.
 *
 * The twelve single-system names are derived from SINGLE_SYSTEMS rather than
 * retyped, so the lobby copy and a shared page can never disagree. Legacy
 * `oracle_type` values written before the engine rebuild are aliased here so
 * shares created by the old Astro/Tarot/Daily routes still render a name.
 */
import { SINGLE_SYSTEMS } from './single-system-ui'

const LEGACY_ORACLE_TYPE_NAMES: Record<string, string> = {
  horoscope: '서양 점성술',
  daily: '오늘의 운세',
}

const SYSTEM_DISPLAY_NAMES: Record<string, string> = {
  ...Object.fromEntries(SINGLE_SYSTEMS.map((system) => [system.id, system.name])),
  ...LEGACY_ORACLE_TYPE_NAMES,
}

/**
 * 궁합 sessions archive with their own oracle_type so a shared 궁합 never
 * renders under a single-reading heading: 'compat' (통합) and
 * 'compat:<systemId>' (단일 체계 궁합).
 */
const COMPAT_ORACLE_TYPE = 'compat'
const COMPAT_ORACLE_TYPE_PREFIX = 'compat:'

export function compatOracleType(systemId?: string | null): string {
  const key = typeof systemId === 'string' ? systemId.trim() : ''
  return key ? `${COMPAT_ORACLE_TYPE_PREFIX}${key}` : COMPAT_ORACLE_TYPE
}

/**
 * Never throws and never returns an empty string: an unknown id renders as
 * itself, because a share page losing its heading is worse than showing a raw
 * id for one row.
 */
export function oracleSystemDisplayName(systemId: string | null | undefined): string {
  const key = typeof systemId === 'string' ? systemId.trim() : ''
  if (!key) return ''
  if (key === COMPAT_ORACLE_TYPE) return '궁합 · 통합 판독'
  if (key.startsWith(COMPAT_ORACLE_TYPE_PREFIX)) {
    const inner = key.slice(COMPAT_ORACLE_TYPE_PREFIX.length)
    const name = SYSTEM_DISPLAY_NAMES[inner] ?? inner
    return `${name} 궁합`
  }
  return SYSTEM_DISPLAY_NAMES[key] ?? key
}
