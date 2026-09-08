/**
 * 오늘의 운세 product constants.
 *
 * Daily is a weave of the systems that actually change on a civil day, read
 * by ONE AI. It is not a panel, not a seer layer, and not a second product
 * beside the existing /modes/oracle/daily route.
 */
import type { SystemId } from '../axes/types'
import type { JsonObject } from './types'

export const ORACLE_DAILY_SYSTEMS = [
  'saju',
  'astro',
  'ninestar',
  'sukuyou',
  'tzolkin',
  'tarot',
  'runes',
] as const satisfies readonly SystemId[]

export type OracleDailySystemId = (typeof ORACLE_DAILY_SYSTEMS)[number]

/**
 * oracle_daily_cache primary key. `date` is the subject's civil day
 * (`civilDateIn(now, profile.tz ?? Asia/Seoul)`), not the engine's zi_start
 * boundary. First miss charges 2; a hit on this key skips create/charge.
 */
export function dailyCacheKey(userId: string, civilDate: string): { user_id: string; date: string } {
  return { user_id: userId, date: civilDate }
}

/**
 * Z.ai: #1 measured saju reader (SYSTEM_READER_ROSTERS.saju) AND the measured
 * integrated synthesizer (INTEGRATED_SYNTHESIZER_BRAND). Daily weaves native
 * charts rather than running a seer panel, so the synthesizer seat is the
 * right brand. Seat-only; layer1EntryForBrand('Z.ai') already exists.
 * Daily calls pin reasoning off and a short completion cap — see
 * applyDailyReaderPolicies in the layer-1 adapter.
 */
export const ORACLE_DAILY_READER_BRAND = 'Z.ai'

export const ORACLE_DAILY_READER_COUNT = 1 as const
export const ORACLE_DAILY_HOST_SYSTEM = 'saju' as const satisfies SystemId
export const ORACLE_DAILY_TAROT_SPREAD = 1 as const
export const ORACLE_DAILY_RUNE_SPREAD = 1 as const

/** Reproduces the same tarot/rune draw for (user, civil day). */
export function dailySeed(userId: string, asOfDate: string): string {
  return `daily:${userId}:${asOfDate}`
}

export type OracleDailyCacheValues = {
  asOfDate: string
  narrative: string
  one_line: string | null
  direction: string | null
  focus: string | null
  brand: string
}

export type DailyCacheRow = {
  user_id: string
  date: string
  values: JsonObject
  session_id: string | null
  computed_at: string
}
