/**
 * System id -> human display name.
 *
 * `oracle_sessions.oracle_type` stores the machine id ('saju'), which is also
 * what the share page reads. The stored value must stay an id so old rows and
 * new rows compare, so the label is resolved at render instead.
 *
 * The eleven single-system names are derived from SINGLE_SYSTEMS rather than
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
  prism: 'PRISM-5',
  ...LEGACY_ORACLE_TYPE_NAMES,
}

/**
 * Never throws and never returns an empty string: an unknown id renders as
 * itself, because a share page losing its heading is worse than showing a raw
 * id for one row.
 */
export function oracleSystemDisplayName(systemId: string | null | undefined): string {
  const key = typeof systemId === 'string' ? systemId.trim() : ''
  if (!key) return ''
  return SYSTEM_DISPLAY_NAMES[key] ?? key
}
