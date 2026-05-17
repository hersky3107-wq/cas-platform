import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  cookieOptionsForRequest,
  getSiteUrl,
  isAllowedAppHost,
  normalizeOrigin,
} from '@/lib/supabase/site-url'

export async function middleware(request: NextRequest) {
  const host = request.nextUrl.host

  if (!isAllowedAppHost(host)) {
    return NextResponse.next({ request })
  }

  if (host.toLowerCase() === 'www.aimani.ai') {
    const url = request.nextUrl.clone()
    url.host = 'aimani.ai'
    url.protocol = 'https:'
    return NextResponse.redirect(url, 308)
  }

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

  if (request.nextUrl.pathname === '/auth' && user) {
    return NextResponse.redirect(
      new URL('/', getSiteUrl(normalizeOrigin(request.nextUrl.origin)))
    )
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
