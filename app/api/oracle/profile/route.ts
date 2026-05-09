import { NextResponse } from 'next/server'
import { createSupabaseWithToken } from '@/lib/supabase/server-client'
import { supabaseAdmin } from '@/lib/supabase/server'
import { createSupabaseRouteAuthClient } from '@/lib/supabase/route-auth'
import type { ApproxBirthBand, Gender, OracleBirthProfileV1 } from '@/lib/oracle/types'
import { oracleProfileLooksComplete } from '@/lib/oracle/profile-guard'
import { approxBandToMidpointHHMM } from '@/lib/oracle/sijin'
import { fetchOracleBirthProfileAdmin, oracleV1ToUsersJson } from '@/lib/oracle/users-oracle-storage'

const COLUMN_HINT_SQL =
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS oracle_birth_profile JSONB;'

export async function GET() {
  const supabaseAuth = await createSupabaseRouteAuthClient()
  const {
    data: { user },
    error: authErr,
  } = await supabaseAuth.auth.getUser()
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

  return NextResponse.json({
    profile: normalized ?? null,
    complete: !!(complete ?? false),
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

  const token = typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined
  const supabaseAuth = token ? createSupabaseWithToken(token) : await createSupabaseRouteAuthClient()
  const {
    data: { user },
    error: authErr,
  } = await supabaseAuth.auth.getUser()
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

  const complete = oracleProfileLooksComplete(oracle_birth_profile)
  return NextResponse.json({ ok: true, profile: oracle_birth_profile, complete })
}
