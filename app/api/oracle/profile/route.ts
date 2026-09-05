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

const RUNNER_PROFILE_COLUMNS =
  'id,birth_date,birth_time,birth_time_source,sex,tz,birth_place,lat,lng,name_local,name_hanja,name_latin,mbti,derived'

type RunnerProfileRow = {
  id: string
  birth_date: string
  birth_time: string | null
  birth_time_source: string
  sex: string | null
  tz: string | null
  birth_place: string | null
  lat: number | null
  lng: number | null
  name_local: string | null
  name_hanja: string | null
  name_latin: string | null
  mbti: string | null
  derived: Record<string, unknown> | null
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
    .select('id,birth_place,lat,lng,tz,derived')
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

  const derived = {
    ...((existing?.derived && typeof existing.derived === 'object' && !Array.isArray(existing.derived)
      ? existing.derived
      : {}) as Record<string, unknown>),
  }
  delete derived.placeholder_birth_date

  const row = {
    user_id: userId,
    label: '나',
    is_self: true,
    ...projected,
    lat,
    lng,
    tz,
    derived,
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
    placeholderBirthDate: runnerProfile?.derived?.placeholder_birth_date === true,
    mbtiEstimated: runnerProfile?.derived?.mbti_estimated === true,
  })
}

function coerceGender(raw: unknown): Gender | null {
  if (raw === 'male' || raw === 'female' || raw === 'prefer_not_to_say') return raw
  return null
}

const MBTI_RE = /^(INTJ|INTP|ENTJ|ENTP|INFJ|INFP|ENFJ|ENFP|ISTJ|ISFJ|ESTJ|ESFJ|ISTP|ISFP|ESTP|ESFP)$/i

async function loadSelfRunner(userId: string): Promise<RunnerProfileRow | null> {
  const { data } = await supabaseAdmin
    .from('oracle_profiles')
    .select(RUNNER_PROFILE_COLUMNS)
    .eq('user_id', userId)
    .eq('is_self', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as RunnerProfileRow | null) ?? null
}

async function ensureStubRunner(userId: string): Promise<RunnerProfileRow | null> {
  const existing = await loadSelfRunner(userId)
  if (existing) return existing
  const { data, error } = await supabaseAdmin
    .from('oracle_profiles')
    .insert({
      user_id: userId,
      label: '나',
      is_self: true,
      birth_date: '1970-01-01',
      birth_time: null,
      birth_time_source: 'unknown',
      derived: { placeholder_birth_date: true },
    })
    .select(RUNNER_PROFILE_COLUMNS)
    .single()
  if (error) {
    console.warn('[oracle/profile] stub insert:', error.message)
    return null
  }
  return data as RunnerProfileRow
}

function composeLocalName(surname: string, given: string, locale: string): { name_local?: string; name_latin?: string } {
  const family = surname.trim()
  const personal = given.trim()
  if (!family || !personal) return {}
  const east = locale === 'ko' || locale === 'ja' || locale.startsWith('zh')
  if (east) return { name_local: `${family}${personal}` }
  return { name_latin: `${personal} ${family}` }
}

async function patchRunnerExtras(
  userId: string,
  patch: Record<string, unknown>,
): Promise<RunnerProfileRow | null> {
  const existing = await loadSelfRunner(userId)
  if (!existing) return null
  if (Object.keys(patch).length === 0) return existing
  const next: Record<string, unknown> = { ...patch }
  if (patch.derived && typeof patch.derived === 'object' && !Array.isArray(patch.derived)) {
    const prev =
      existing.derived && typeof existing.derived === 'object' && !Array.isArray(existing.derived)
        ? existing.derived
        : {}
    next.derived = { ...prev, ...(patch.derived as Record<string, unknown>) }
  }
  const { data, error } = await supabaseAdmin
    .from('oracle_profiles')
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq('id', existing.id)
    .eq('user_id', userId)
    .select(RUNNER_PROFILE_COLUMNS)
    .single()
  if (error) {
    console.warn('[oracle/profile] extras patch:', error.message)
    return null
  }
  return data as RunnerProfileRow
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

  const extrasPatch: Record<string, unknown> = {}
  const surname = typeof body.name_surname === 'string' ? body.name_surname.trim() : ''
  const given = typeof body.name_given === 'string' ? body.name_given.trim() : ''
  const nameLocale = typeof body.name_locale === 'string' && body.name_locale.trim() ? body.name_locale.trim() : 'ko'
  if (surname && given) Object.assign(extrasPatch, composeLocalName(surname, given, nameLocale))
  if (typeof body.name_latin === 'string' && body.name_latin.trim()) {
    extrasPatch.name_latin = body.name_latin.trim()
  }
  if (typeof body.mbti === 'string' && body.mbti.trim()) {
    const mbti = body.mbti.trim().toUpperCase()
    if (!MBTI_RE.test(mbti)) {
      return NextResponse.json({ error: 'mbti must be a 4-letter MBTI type' }, { status: 400 })
    }
    extrasPatch.mbti = mbti
    extrasPatch.derived = { mbti_estimated: body.mbti_estimated === true }
  }

  if (body.ensureStub === true) {
    const stub = await ensureStubRunner(user.id)
    if (!stub) return NextResponse.json({ error: 'Could not create a reading profile' }, { status: 500 })
    const patched = Object.keys(extrasPatch).length ? await patchRunnerExtras(user.id, extrasPatch) : stub
    // A failed extras write is a FAILURE, not a degraded success — returning
    // ok:true here made the client navigate on while the engine row kept the
    // old (or no) name. See FIX 7.
    if (!patched) {
      return NextResponse.json({ error: '프로필을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
    }
    return NextResponse.json({
      ok: true,
      profile: null,
      complete: false,
      runnerProfile: patched,
      subjectProfileId: patched.id,
      placeholderBirthDate: patched.derived?.placeholder_birth_date === true,
      mbtiEstimated: patched.derived?.mbti_estimated === true,
    })
  }

  const dob = typeof body.dob === 'string' ? body.dob.trim() : ''
  const extrasOnly = dob === '' && (surname !== '' || given !== '' || typeof body.name_latin === 'string' || typeof body.mbti === 'string')
  if (extrasOnly) {
    let existing = await loadSelfRunner(user.id)
    if (!existing) {
      existing = await ensureStubRunner(user.id)
    }
    if (!existing) {
      return NextResponse.json({ error: 'Could not create a reading profile' }, { status: 500 })
    }
    const patched = await patchRunnerExtras(user.id, extrasPatch)
    // FIX 7: this used to answer ok:true with runnerProfile:null when the
    // UPDATE failed. The client then navigated to the reading, which read the
    // STALE profile row — the user "failed" to save a name yet still got a
    // 성명학 reading from the old one. A failed write is now a failed request.
    if (!patched) {
      return NextResponse.json({ error: '이름을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
    }
    return NextResponse.json({
      ok: true,
      profile: null,
      complete: false,
      runnerProfile: patched,
      subjectProfileId: patched.id,
      placeholderBirthDate: patched.derived?.placeholder_birth_date === true,
      mbtiEstimated: patched.derived?.mbti_estimated === true,
    })
  }

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

  const oracle_birth_profile: OracleBirthProfileV1 = {
    version: 1,
    dob,
    birth_city: birthCity,
    gender: gender ?? 'prefer_not_to_say',
    birth_time_known,
    birth_time_24h: effectiveTime,
    ...(time_approx_band ? { time_approx_band: time_approx_band as ApproxBirthBand } : { time_approx_band: null }),
    time_from_survey: time_from_survey || undefined,
    resolved_sijin_kr: resolved_sijin_kr ?? undefined,
    survey_selections: survey_selections ?? undefined,
    completed_at: new Date().toISOString(),
  }

  const storedProfile = birthCity && (oracle_birth_profile.birth_time_known || oracle_birth_profile.time_from_survey || oracle_birth_profile.time_approx_band)
    ? oracleV1ToUsersJson(oracle_birth_profile)
    : oracle_birth_profile

  const patch = await supabaseAdmin
    .from('users')
    .update({
      oracle_birth_profile: storedProfile,
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
  // FIX 7: if the runner row (the copy every engine actually reads) failed to
  // write, the two stores are out of sync — surface it instead of ok:true.
  if (!runnerProfile) {
    return NextResponse.json(
      { error: '프로필 저장이 완전히 끝나지 않았습니다. 잠시 후 다시 저장해 주세요.' },
      { status: 500 },
    )
  }
  const withExtras =
    Object.keys(extrasPatch).length > 0
      ? await patchRunnerExtras(user.id, extrasPatch)
      : runnerProfile
  if (!withExtras) {
    return NextResponse.json({ error: '이름을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }

  const complete = oracleProfileLooksComplete(oracle_birth_profile)
  return NextResponse.json({
    ok: true,
    profile: oracle_birth_profile,
    complete,
    runnerProfile: withExtras,
    subjectProfileId: withExtras.id,
    placeholderBirthDate: withExtras.derived?.placeholder_birth_date === true,
    mbtiEstimated: withExtras.derived?.mbti_estimated === true,
  })
}
