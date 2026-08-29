/**
 * Projection from the ONE birth form (users.oracle_birth_profile, V1) into the
 * runner's oracle_profiles columns.
 *
 * /modes/oracle/profile is the only place birth data is collected. Every system
 * reads the projection instead of asking again, so this file is the single
 * mapping between the two stores. Pure: no DB, no network, no clock.
 *
 * The 15-question 시진 estimator is the unknown-time path — a survey result
 * lands here as birth_time_source 'estimated' with its HH:mm carried through,
 * NOT as a dropped time.
 */
import type { OracleBirthTimeSource, OracleSex } from './schema'
import type { OracleBirthProfileV1 } from './types'

export type RunnerProfileProjection = {
  birth_date: string
  /** HH:mm:ss, or null when no time could be established at all. */
  birth_time: string | null
  birth_time_source: OracleBirthTimeSource
  /** ONLY used for 대운 direction. Never sent to any AI. */
  sex: OracleSex | null
  birth_place: string | null
  survey_answers: Record<string, unknown> | null
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** '9:05' and '09:05' both mean 09:05:00; anything else means "no time". */
export function normalizeBirthTime(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const match = HHMM.exec(raw.trim())
  if (!match) return null
  return `${match[1].padStart(2, '0')}:${match[2]}:00`
}

function sexFromGender(gender: OracleBirthProfileV1['gender']): OracleSex | null {
  if (gender === 'male') return 'M'
  if (gender === 'female') return 'F'
  return null
}

export function projectV1ToRunnerProfile(v1: OracleBirthProfileV1): RunnerProfileProjection {
  const birthTime = normalizeBirthTime(v1.birth_time_24h)
  const estimated = v1.time_from_survey === true || v1.time_approx_band != null

  const source: OracleBirthTimeSource =
    birthTime === null ? 'unknown' : v1.birth_time_known ? 'exact' : estimated ? 'estimated' : 'unknown'

  const place = typeof v1.birth_city === 'string' ? v1.birth_city.trim() : ''

  return {
    birth_date: v1.dob,
    // 'unknown' and a stored clock value are contradictory; keep the column honest.
    birth_time: source === 'unknown' ? null : birthTime,
    birth_time_source: source,
    sex: sexFromGender(v1.gender),
    birth_place: place === '' ? null : place,
    survey_answers: v1.survey_selections ? { ...v1.survey_selections } : null,
  }
}
