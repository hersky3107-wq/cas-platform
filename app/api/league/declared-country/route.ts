import { NextResponse } from 'next/server'
import { normalizeSignupCountry } from '@/lib/league/jurisdiction/signup-countries'
import { resolveLeagueViewer } from '@/lib/league/public-access'
import { supabaseAdmin } from '@/lib/supabase/server'

/**
 * POST /api/league/declared-country
 *
 * Sets `users.declared_country` for the signed-in caller. Existing accounts
 * may still be null; this is the first-touch path. Does not invent a country
 * from the IP header.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const auth = await resolveLeagueViewer(req, body)
  if (!auth.ok) return auth.response

  const country = normalizeSignupCountry(body.country)
  if (!country) {
    return NextResponse.json({ error: 'Unknown country', code: 'unknown_country' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('users').update({ declared_country: country }).eq('id', auth.viewer.userId)
  if (error) {
    return NextResponse.json({ error: 'Could not save country' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, declaredCountry: country })
}
