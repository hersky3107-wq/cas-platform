import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { cookieOptionsForRequest, isAllowedAppHost } from '@/lib/supabase/site-url'

export async function middleware(request: NextRequest) {
  const host = request.nextUrl.host

  if (!isAllowedAppHost(host)) {
    return NextResponse.next({ request })
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
    return supabaseResponse
  }

  if (request.nextUrl.pathname === '/' && !user) {
    return NextResponse.redirect(new URL('/landing', request.url))
  }

  if (request.nextUrl.pathname.startsWith('/landing')) {
    if (user) {
      return NextResponse.redirect(new URL('/', request.url))
    }
    return supabaseResponse
  }

  if (
    !user &&
    (request.nextUrl.pathname.startsWith('/modes/') ||
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

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
