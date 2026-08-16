import { NextResponse } from 'next/server'
import { getIpCountryFromHeaders } from '@/lib/geo/ip-country'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { supabaseAdmin } from '@/lib/supabase/server'

/**
 * Read-only SIGNAL endpoint shared by BOTH independent gating layers:
 * i18n locale resolution (Layer A) and jurisdiction resolution (Layer B).
 *
 * This route makes NO decision — it does not compute a locale and does not
 * decide whether anything is visible. It only surfaces raw inputs:
 *  - `acceptLanguage` / `ipCountry`: read from the request/platform.
 *  - `profileLocale` / `declaredCountry`: read from the caller's OWN
 *    `users` row, if logged in.
 *
 * The actual policy (`resolveLeagueLocale`, `isCategoryAllowed`) runs
 * client-side (or could run server-side elsewhere) as pure functions over
 * these signals — see `lib/league/i18n/resolve-locale.ts` and
 * `lib/league/jurisdiction/resolve.ts`. Keeping resolution here would have
 * been the "easy" path but would re-couple the two layers to one request
 * handler; this way each layer's tests exercise plain functions, and this
 * route is just plumbing.
 *
 * Intentionally NOT admin-gated: every visitor (logged in or not) needs
 * their own signals resolved, not just admins previewing the card.
 */
export async function GET(req: Request) {
  const acceptLanguage = req.headers.get('accept-language')
  let ipCountry = getIpCountryFromHeaders(req.headers)

  // DEV-ONLY escape hatch: local dev has no real `x-vercel-ip-country` header
  // (that's a Vercel-platform header), so there is no way to exercise
  // Layer B's IP-based path without it. Never active in production —
  // real jurisdiction resolution always uses the platform header there.
  const url = new URL(req.url)
  let devDeclaredCountry: string | null = null
  if (process.env.NODE_ENV !== 'production') {
    const devIpCountry = url.searchParams.get('dev_ip_country')
    if (devIpCountry) ipCountry = devIpCountry.toUpperCase()
    devDeclaredCountry = url.searchParams.get('dev_declared_country')
  }

  let profileLocale: string | null = null
  let declaredCountry: string | null = devDeclaredCountry ? devDeclaredCountry.toUpperCase() : null

  const { user } = await resolveRouteAuth(req)
  if (user?.id) {
    // `declared_country` requires the 20260816000001_users_declared_country.sql
    // migration. Guarded separately from `ui_locale` (long-standing column) so a
    // not-yet-migrated environment still gets locale resolution instead of a
    // hard failure on this whole endpoint.
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('ui_locale, declared_country')
      .eq('id', user.id)
      .maybeSingle()
    if (!error) {
      profileLocale = (data?.ui_locale as string | null | undefined) ?? null
      declaredCountry = declaredCountry ?? ((data?.declared_country as string | null | undefined) ?? null)
    } else {
      const fallback = await supabaseAdmin.from('users').select('ui_locale').eq('id', user.id).maybeSingle()
      profileLocale = (fallback.data?.ui_locale as string | null | undefined) ?? null
    }
  }

  return NextResponse.json({ acceptLanguage, ipCountry, profileLocale, declaredCountry })
}
