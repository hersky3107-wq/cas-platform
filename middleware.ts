import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  attachBypassCookie,
  evaluateRouteLock,
  routeLockBlockedResponse,
} from '@/lib/middleware/route-lock'
import { cookieOptionsForRequest, isAllowedAppHost } from '@/lib/supabase/site-url'
import {
  isReconPublic,
  isReconciliationPath,
  issueWorkspaceCookieValue,
  parseWorkspaceCookie,
  reconWsCookieOptions,
  RECON_WS_COOKIE,
} from '@/lib/reconciliation/public-access'

function withOptionalBypassCookie(response: NextResponse, setBypass: boolean): NextResponse {
  if (setBypass) attachBypassCookie(response)
  return response
}

export async function middleware(request: NextRequest) {
  // ── Route lock (aimani.ai deploy): /care + /jeju only — runs BEFORE auth. ──
  const lockDecision = evaluateRouteLock(request)
  if (lockDecision.action === 'block') {
    return routeLockBlockedResponse()
  }
  const setBypassCookie = lockDecision.action === 'pass_set_bypass'

  const host = request.nextUrl.host

  if (!isAllowedAppHost(host)) {
    return withOptionalBypassCookie(NextResponse.next({ request }), setBypassCookie)
  }

  const pathname = request.nextUrl.pathname

  // Public competition demo — /festival + /api/festival/* require no login and
  // bypass all auth redirects. Credit gating does not apply to these routes.
  if (
    pathname === '/festival' ||
    pathname.startsWith('/festival/') ||
    pathname.startsWith('/api/festival/')
  ) {
    return withOptionalBypassCookie(NextResponse.next({ request }), setBypassCookie)
  }

  // Do NOT redirect www ↔ apex here. Vercel already redirects aimani.ai → www.aimani.ai;
  // a www → apex redirect in middleware caused ERR_TOO_MANY_REDIRECTS.

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(
              name,
              value,
              cookieOptionsForRequest(request, options)
            )
          })
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (request.nextUrl.pathname.startsWith('/admin')) {
    return withOptionalBypassCookie(supabaseResponse, setBypassCookie)
  }

  if (request.nextUrl.pathname === '/' && !user) {
    return NextResponse.redirect(new URL('/landing', request.url))
  }

  if (request.nextUrl.pathname.startsWith('/landing')) {
    if (user) {
      return NextResponse.redirect(new URL('/', request.url))
    }
    return withOptionalBypassCookie(supabaseResponse, setBypassCookie)
  }

  // `/league` is the public (logged-in) league surface. Every league API route
  // enforces auth on its own — this redirect only saves a signed-out visitor
  // from landing on a page that would render nothing but 401s.
  if (
    !user &&
    (request.nextUrl.pathname.startsWith('/modes/') ||
      request.nextUrl.pathname === '/league' ||
      request.nextUrl.pathname.startsWith('/league/') ||
      request.nextUrl.pathname.startsWith('/settings'))
  ) {
    const loginUrl = new URL('/auth', request.url)
    loginUrl.searchParams.set(
      'redirectTo',
      `${request.nextUrl.pathname}${request.nextUrl.search}`
    )
    return NextResponse.redirect(loginUrl)
  }

  // Logged-in users: leave /auth (same host — no cross-domain redirect)
  if (request.nextUrl.pathname === '/auth' && user) {
    const redirectTo = request.nextUrl.searchParams.get('redirectTo')
    if (
      redirectTo &&
      redirectTo.startsWith('/') &&
      !redirectTo.startsWith('//') &&
      !redirectTo.includes('://')
    ) {
      return NextResponse.redirect(new URL(redirectTo, request.url))
    }
    return NextResponse.redirect(new URL('/', request.url))
  }

  const outgoing = withOptionalBypassCookie(supabaseResponse, setBypassCookie)

  // Contest public access: stamp a workspace cookie on /reconciliation and
  // /api/reconciliation/* ONLY. Does not change league/oracle/arena redirects
  // above. Off (env unset) → this block is a no-op.
  if (isReconPublic() && isReconciliationPath(pathname)) {
    const existing = request.cookies.get(RECON_WS_COOKIE)?.value
    const valid = await parseWorkspaceCookie(existing)
    if (!valid) {
      const issued = await issueWorkspaceCookieValue()
      if (issued) {
        outgoing.cookies.set(RECON_WS_COOKIE, issued, reconWsCookieOptions())
      }
    }
  }

  return outgoing
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
