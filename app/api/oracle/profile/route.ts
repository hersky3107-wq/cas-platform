import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import type { ApproxBirthBand, Gender, OracleBirthProfileV1 } from '@/lib/oracle/types'
import { oracleProfileLooksComplete } from '@/lib/oracle/profile-guard'
import { approxBandToMidpointHHMM } from '@/lib/oracle/sijin'
import { geocodeBirthCity } from '@/lib/oracle/geocode'
import { projectV1ToRunnerProfile } from '@/lib/oracle/runner-profile-projection'
import { fetchOracleBirthProfileAdmin, oracleV1ToUsersJson } from '@/lib/oracle/users-oracle-storage'

const COLUMN_HINT_SQL =
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS oracle_birth_profile JSONB;'

const RUNNER_PROFILE_COLUMNS = 'id,birth_date,birth_time,birth_time_source,sex,tz'

type RunnerProfileRow = {
  id: string
  birth_date: string
  birth_time: string | null
  birth_time_source: string
  sex: string | null
  tz: string | null
}

/**
 * Materialize the runner's projection of the ONE birth form.
 *
 * oracle_profiles is derived data, so this is an upsert of the self row rather
 * than a second profile identity. The birth city is geocoded ONCE — only when
 * it changed or coordinates are missing — because that is a third-party call on
 * a path the lobby hits. A geocode failure is not a save failure: the runner
 * falls back to its default timezone/coords and records the substitution as an
 * assumption.
 */
async function syncRunnerProfile(
  userId: string,
  v1: OracleBirthProfileV1,
): Promise<RunnerProfileRow | null> {
  const projected = projectV1ToRunnerProfile(v1)

  const { data: existing, error: readError } = await supabaseAdmin
    .from('oracle_profiles')
    .select('id,birth_place,lat,lng,tz')
    .eq('user_id', userId)
    .eq('is_self', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (readError) {
    console.warn('[oracle/profile] runner profile read:', readError.message)
    return null
  }

  const placeChanged = (existing?.birth_place ?? null) !== projected.birth_place
  const needsCoordinates =
    existing == null || placeChanged || existing.lat == null || existing.lng == null

  let lat = typeof existing?.lat === 'number' ? existing.lat : null
  let lng = typeof existing?.lng === 'number' ? existing.lng : null
  let tz = typeof existing?.tz === 'string' ? existing.tz : null

  if (needsCoordinates && projected.birth_place) {
    const geo = await geocodeBirthCity(projected.birth_place).catch(() => null)
    if (geo) {
      lat = geo.latitude
      lng = geo.longitude
      tz = geo.timezone ?? tz
    } else if (placeChanged) {
      lat = null
      lng = null
    }
  }

  const row = {
    user_id: userId,
    label: '나',
    is_self: true,
    ...projected,
    lat,
    lng,
    tz,
    updated_at: new Date().toISOString(),
  }

  const query = existing?.id
    ? supabaseAdmin.from('oracle_profiles').update(row).eq('id', existing.id).eq('user_id', userId)
    : supabaseAdmin.from('oracle_profiles').insert(row)

  const { data, error } = await query.select(RUNNER_PROFILE_COLUMNS).single()
  if (error) {
    console.warn('[oracle/profile] runner profile write:', error.message)
    return null
  }
  return data as RunnerProfileRow
}

export async function GET(req: Request) {
  const { user, error: authErr } = await resolveRouteAuth(req)
  if (authErr || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const { v1: normalized, error } = await fetchOracleBirthProfileAdmin(user.id)
  if (error) {
    console.warn('[oracle/profile GET]', error)
    return NextResponse.json({ error: 'Could not load profile' }, { status: 500 })
  }

  const complete =
    normalized && typeof normalized === 'object' && oracleProfileLooksComplete(normalized)

  const { data: stored } = await supabaseAdmin
    .from('oracle_profiles')
    .select(RUNNER_PROFILE_COLUMNS)
    .eq('user_id', user.id)
    .eq('is_self', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Backfill for sketches saved before the two stores were unified, so an
  // existing profile is never re-collected just because the projection is new.
  let runnerProfile = (stored as RunnerProfileRow | null) ?? null
  if (!runnerProfile && complete && normalized) {
    runnerProfile = await syncRunnerProfile(user.id, normalized)
  }

  return NextResponse.json({
    profile: normalized ?? null,
    complete: !!(complete ?? false),
    runnerProfile,
    subjectProfileId: runnerProfile?.id ?? null,
  })
}

function coerceGender(raw: unknown): Gender | null {
  if (raw === 'male' || raw === 'female' || raw === 'prefer_not_to_say') return raw
  return null
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { user, error: authErr } = await resolveRouteAuth(req, body)
  if (authErr || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const dob = typeof body.dob === 'string' ? body.dob.trim() : ''
  const birthCity = typeof body.birth_city === 'string' ? body.birth_city.trim() : ''
  const gender = coerceGender(body.gender)
  const birth_time_known = body.birth_time_known === true
  let birth_time_24h = typeof body.birth_time_24h === 'string' ? body.birth_time_24h.trim() : null
  const time_approx_band = typeof body.time_approx_band === 'string' ? body.time_approx_band.trim() : null
  const time_from_survey = body.time_from_survey === true
  const resolved_sijin_kr =
    typeof body.resolved_sijin_kr === 'string' ? body.resolved_sijin_kr.trim() : null
  const survey_selectionsRaw = body.survey_selections
  let survey_selections: OracleBirthProfileV1['survey_selections']

  if (survey_selectionsRaw && typeof survey_selectionsRaw === 'object' && !Array.isArray(survey_selectionsRaw)) {
    survey_selections = survey_selectionsRaw as OracleBirthProfileV1['survey_selections']
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return NextResponse.json({ error: 'Invalid date of birth' }, { status: 400 })
  }
  if (!birthCity) return NextResponse.json({ error: 'City of birth required' }, { status: 400 })
  if (!gender) return NextResponse.json({ error: 'Gender required' }, { status: 400 })

  if (birth_time_known) {
    if (!birth_time_24h || !/^([01]?\d|2[0-3]):([0-5]\d)$/.test(birth_time_24h)) {
      return NextResponse.json({ error: 'Valid birth time (HH:mm) required' }, { status: 400 })
    }
  } else if (time_approx_band) {
    const band = time_approx_band as ApproxBirthBand
    birth_time_24h = approxBandToMidpointHHMM(band)
  }

  const effectiveTime =
    birth_time_24h && /^([01]?\d|2[0-3]):([0-5]\d)$/.test(birth_time_24h) ? birth_time_24h : null

  if (!birth_time_known && !effectiveTime) {
    return NextResponse.json(
      {
        error: 'Provide an exact time or complete all 15 birth-time questions.',
      },
      { status: 400 }
    )
  }

  const oracle_birth_profile: OracleBirthProfileV1 = {
    version: 1,
    dob,
    birth_city: birthCity,
    gender,
    birth_time_known,
    birth_time_24h: effectiveTime ?? '12:00',
    ...(time_approx_band ? { time_approx_band: time_approx_band as ApproxBirthBand } : { time_approx_band: null }),
    time_from_survey: time_from_survey || undefined,
    resolved_sijin_kr: resolved_sijin_kr ?? undefined,
    survey_selections: survey_selections ?? undefined,
    completed_at: new Date().toISOString(),
  }

  const patch = await supabaseAdmin
    .from('users')
    .update({
      oracle_birth_profile: oracleV1ToUsersJson(oracle_birth_profile),
    })
    .eq('id', user.id)

  if (patch.error) {
    console.warn('[oracle/profile POST]', patch.error.message)
    return NextResponse.json(
      {
        error: patch.error.message,
        hint: `Ensure public.users.oracle_birth_profile JSONB exists. Run in Supabase SQL editor:\n${COLUMN_HINT_SQL}`,
      },
      { status: 500 }
    )
  }

  // Both stores, one form. The runner row is derived from the sketch that was
  // just saved, so a system can never read a stale chart.
  const runnerProfile = await syncRunnerProfile(user.id, oracle_birth_profile)

  const complete = oracleProfileLooksComplete(oracle_birth_profile)
  return NextResponse.json({
    ok: true,
    profile: oracle_birth_profile,
    complete,
    runnerProfile,
    subjectProfileId: runnerProfile?.id ?? null,
  })
}
