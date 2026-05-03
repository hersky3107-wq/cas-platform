import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/** Paths accessible without login (prefix match except `/`). */
const PUBLIC_PATH_PREFIXES = [
  '/modes/compare',
  '/modes/custom',
  '/modes/persona',
  '/modes/verdict',
]

function isPublicPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '/auth' || pathname === '/about') return true
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const pathname = request.nextUrl.pathname

  if (pathname.startsWith('/api')) {
    return supabaseResponse
  }

  if (isPublicPath(pathname)) {
    return supabaseResponse
  }

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = '/auth'
      return NextResponse.redirect(url)
    }
  } catch {
    return supabaseResponse
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
