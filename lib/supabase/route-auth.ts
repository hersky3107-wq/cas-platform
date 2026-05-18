import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createSupabaseWithToken } from '@/lib/supabase/server-client'

function parseCookieHeader(header: string | null): { name: string; value: string }[] {
  if (!header) return []
  const out: { name: string; value: string }[] = []
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const name = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (name) out.push({ name, value })
  }
  return out
}

function mergeCookies(
  ...lists: { name: string; value: string }[][]
): { name: string; value: string }[] {
  const map = new Map<string, { name: string; value: string }>()
  for (const list of lists) {
    for (const c of list) {
      map.set(c.name, c)
    }
  }
  return [...map.values()]
}

/**
 * Supabase auth client for Next.js Route Handlers (App Router).
 * Pass the incoming `Request` when available so cookies are read from the request header.
 */
export async function createSupabaseRouteAuthClient(request?: Request) {
  const cookieStore = await cookies()
  const headerCookies = parseCookieHeader(request?.headers.get('cookie') ?? null)
  const storeCookies = cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }))
  const allCookies = mergeCookies(headerCookies, storeCookies)

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return allCookies.length ? allCookies : cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, {
                ...options,
                path: '/',
                sameSite: 'none',
                secure: true,
              })
            })
          } catch {
            // setAll can throw when called from a Server Component context
          }
        },
      },
    }
  )
}

export type RouteAuthResult = {
  user: Awaited<
    ReturnType<Awaited<ReturnType<typeof createSupabaseRouteAuthClient>>['auth']['getUser']>
  >['data']['user']
  supabase: Awaited<ReturnType<typeof createSupabaseRouteAuthClient>>
  error: Error | null
  accessToken: string | null
}

/** Cookie session first, then Bearer / body token (production-safe fallback). */
export async function resolveRouteAuth(
  request?: Request,
  body?: Record<string, unknown>
): Promise<RouteAuthResult> {
  const tokenFromBody =
    typeof body?.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined
  const authHeader = request?.headers.get('authorization')
  const tokenFromHeader =
    authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined
  const token = tokenFromBody || tokenFromHeader

  const cookieClient = await createSupabaseRouteAuthClient(request)

  const userResult = await cookieClient.auth.getUser()
  if (userResult.data.user) {
    const { data: { session } } = await cookieClient.auth.getSession()
    return {
      user: userResult.data.user,
      supabase: cookieClient,
      error: userResult.error ?? null,
      accessToken: token ?? session?.access_token ?? null,
    }
  }

  if (token) {
    const tokenClient = createSupabaseWithToken(token)
    const tokenUserResult = await tokenClient.auth.getUser()
    if (tokenUserResult.data.user) {
      return {
        user: tokenUserResult.data.user,
        supabase: tokenClient,
        error: null,
        accessToken: token,
      }
    }
    return {
      user: null,
      supabase: tokenClient,
      error: tokenUserResult.error ?? null,
      accessToken: token,
    }
  }

  const { data: { session } } = await cookieClient.auth.getSession()
  if (session?.access_token) {
    const tokenClient = createSupabaseWithToken(session.access_token)
    const retry = await tokenClient.auth.getUser()
    if (retry.data.user) {
      return {
        user: retry.data.user,
        supabase: tokenClient,
        error: null,
        accessToken: session.access_token,
      }
    }
  }

  return {
    user: null,
    supabase: cookieClient,
    error: userResult.error ?? null,
    accessToken: null,
  }
}

export function missingSupabaseEnv(): string | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    return 'NEXT_PUBLIC_SUPABASE_URL'
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) {
    return 'NEXT_PUBLIC_SUPABASE_ANON_KEY'
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return 'SUPABASE_SERVICE_ROLE_KEY'
  }
  return null
}
