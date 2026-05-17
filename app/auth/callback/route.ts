import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { cookieOptionsForRequest, getSiteUrl, normalizeOrigin } from '@/lib/supabase/site-url'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const siteUrl = getSiteUrl(normalizeOrigin(requestUrl.origin))
  const code = requestUrl.searchParams.get('code')
  const authError = requestUrl.searchParams.get('error_description')

  if (authError) {
    return NextResponse.redirect(
      `${siteUrl}/auth?error=${encodeURIComponent(authError)}`
    )
  }

  let response = NextResponse.redirect(`${siteUrl}/`)

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(
                name,
                value,
                cookieOptionsForRequest(request, options)
              )
            })
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(
        `${siteUrl}/auth?error=${encodeURIComponent(error.message)}`
      )
    }
  }

  return response
}
