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

  // Logged-in users: leave /auth for home (same host — no cross-domain redirect)
  if (request.nextUrl.pathname === '/auth' && user) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
