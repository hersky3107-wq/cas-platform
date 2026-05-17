import type { NextRequest } from 'next/server'

const LOCAL_HOSTS = new Set(['localhost:3000', '127.0.0.1:3000'])

const PRODUCTION_HOSTS = new Set(['aimani.ai', 'www.aimani.ai'])

export const CANONICAL_PRODUCTION_ORIGIN = 'https://aimani.ai'

/** Canonical app URL for auth redirects (env → production default → Vercel → request → localhost). */
export function getSiteUrl(fallbackOrigin?: string): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
  if (fromEnv) return fromEnv

  if (fallbackOrigin) {
    const normalized = normalizeOrigin(fallbackOrigin)
    if (normalized.includes('aimani.ai')) {
      try {
        return productionOriginForRequest(new URL(normalized).host)
      } catch {
        return CANONICAL_PRODUCTION_ORIGIN
      }
    }
    return normalized
  }

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`

  return 'http://localhost:3000'
}

export function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin
  } catch {
    return origin.replace(/\/$/, '')
  }
}

/** Prefer www when Vercel canonical host is www (aimani.ai redirects there at the edge). */
export function productionOriginForRequest(host: string): string {
  const h = host.toLowerCase()
  if (h === 'www.aimani.ai') return 'https://www.aimani.ai'
  if (h === 'aimani.ai') return CANONICAL_PRODUCTION_ORIGIN
  return CANONICAL_PRODUCTION_ORIGIN
}

export function isAllowedAppHost(host: string): boolean {
  const h = host.toLowerCase()
  if (LOCAL_HOSTS.has(h) || PRODUCTION_HOSTS.has(h)) return true
  if (h.endsWith('.vercel.app')) return true
  return false
}

/**
 * Cookie options for Supabase auth on route handlers / middleware.
 * Host-only cookies (no Domain=) — more reliable for magic-link / PKCE on aimani.ai.
 */
export function cookieOptionsForRequest(
  request: NextRequest,
  options?: Record<string, unknown>
) {
  const host = request.nextUrl.host.toLowerCase()
  const secure =
    process.env.NODE_ENV === 'production' ||
    request.nextUrl.protocol === 'https:' ||
    PRODUCTION_HOSTS.has(host) ||
    host.endsWith('.vercel.app')

  return {
    ...options,
    path: typeof options?.path === 'string' ? options.path : '/',
    sameSite: (options?.sameSite as 'lax' | 'strict' | 'none') ?? 'lax',
    secure: typeof options?.secure === 'boolean' ? options.secure : secure,
  }
}
