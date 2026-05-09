import { supabaseAdmin } from '@/lib/supabase/server'
import type { ApproxBirthBand, Gender, OracleBirthProfileV1 } from '@/lib/oracle/types'
import { approxBandToMidpointHHMM } from '@/lib/oracle/sijin'

/** Column shape saved on `public.users.oracle_birth_profile`. */
export type UsersOracleBirthProfileJson = {
  date_of_birth: string
  birth_time: string
  birth_city: string
  gender: Gender
  time_method: 'exact' | 'survey' | 'band'
  survey_selections?: OracleBirthProfileV1['survey_selections']
  resolved_sijin_kr?: string | null
  time_approx_band?: ApproxBirthBand | null
}

function coerceGender(g: unknown): Gender | null {
  if (g === 'male' || g === 'female' || g === 'prefer_not_to_say') return g
  return null
}

/** Internal V1 (used by readers/resolvers); stored as flattened JSON on `users`. */
export function oracleV1ToUsersJson(v1: OracleBirthProfileV1): UsersOracleBirthProfileJson {
  const hasSurveySelections =
    v1.survey_selections &&
    typeof v1.survey_selections === 'object' &&
    Object.keys(v1.survey_selections).length > 0

  const time_method: UsersOracleBirthProfileJson['time_method'] = v1.birth_time_known
    ? 'exact'
    : v1.time_from_survey || hasSurveySelections
      ? 'survey'
      : v1.time_approx_band
        ? 'band'
        : 'survey'

  const out: UsersOracleBirthProfileJson = {
    date_of_birth: v1.dob,
    birth_time: v1.birth_time_24h ?? '12:00',
    birth_city: v1.birth_city,
    gender: v1.gender,
    time_method,
  }

  if (time_method === 'survey') {
    if (v1.survey_selections) out.survey_selections = v1.survey_selections
    out.resolved_sijin_kr = v1.resolved_sijin_kr ?? null
  }

  if (time_method === 'band' && v1.time_approx_band) {
    out.time_approx_band = v1.time_approx_band
  }

  return out
}

export function usersJsonToOracleV1(raw: unknown): OracleBirthProfileV1 | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>

  // Legacy blob already in OracleBirthProfileV1 shape on `users`.
  if (o.version === 1 && typeof o.dob === 'string') {
    return o as OracleBirthProfileV1
  }

  const dob = typeof o.date_of_birth === 'string' ? o.date_of_birth.trim() : ''
  const birth_city = typeof o.birth_city === 'string' ? o.birth_city.trim() : ''
  const bt = typeof o.birth_time === 'string' ? o.birth_time.trim() : ''
  const gender = coerceGender(o.gender)
  const tm = o.time_method

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dob) ||
    !birth_city ||
    !gender ||
    (tm !== 'exact' && tm !== 'survey' && tm !== 'band')
  ) {
    return null
  }

  const birth_time_known = tm === 'exact'
  const time_from_survey = tm === 'survey'

  let time_approx_band: ApproxBirthBand | null = null
  let birth_time_24h = bt
  let survey_selections: OracleBirthProfileV1['survey_selections'] | undefined
  let resolved_sijin_kr: string | undefined

  if (tm === 'exact') {
    survey_selections = undefined
    resolved_sijin_kr = undefined
  } else if (tm === 'survey') {
    if (
      o.survey_selections &&
      typeof o.survey_selections === 'object' &&
      !Array.isArray(o.survey_selections)
    ) {
      survey_selections = o.survey_selections as OracleBirthProfileV1['survey_selections']
    }
    if (typeof o.resolved_sijin_kr === 'string')
      resolved_sijin_kr = o.resolved_sijin_kr.trim()
  } else {
    const bandRaw = typeof o.time_approx_band === 'string' ? o.time_approx_band.trim() : null
    const validBands: ApproxBirthBand[] = [
      'EARLY_MORNING',
      'MORNING',
      'MIDDAY',
      'AFTERNOON',
      'EVENING',
      'NIGHT',
    ]
    const band =
      bandRaw && (validBands as string[]).includes(bandRaw)
        ? (bandRaw as ApproxBirthBand)
        : null
    if (!band) return null
    time_approx_band = band
    if (!birth_time_24h || birth_time_24h === '') {
      birth_time_24h = approxBandToMidpointHHMM(band)
    }
    survey_selections = undefined
    resolved_sijin_kr = undefined
  }

  const v: OracleBirthProfileV1 = {
    version: 1,
    dob,
    birth_city,
    gender,
    birth_time_known,
    birth_time_24h: birth_time_24h || '12:00',
    time_approx_band: time_approx_band ?? null,
    time_from_survey: time_from_survey || undefined,
    resolved_sijin_kr: resolved_sijin_kr ?? undefined,
    survey_selections,
  }

  return v
}

export async function fetchOracleBirthProfileAdmin(
  userId: string,
): Promise<{ v1: OracleBirthProfileV1 | null; error: string | null }> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('oracle_birth_profile')
    .eq('id', userId)
    .maybeSingle()

  if (error) return { v1: null, error: error.message }

  const json = (
    data as { oracle_birth_profile?: unknown } | null
  )?.oracle_birth_profile
  const v1 = usersJsonToOracleV1(json)
  return { v1, error: null }
}
