import type { NextRequest } from 'next/server'

const LOCAL_HOSTS = new Set(['localhost:3000', '127.0.0.1:3000'])

const PRODUCTION_HOSTS = new Set(['aimani.ai', 'www.aimani.ai'])

const CANONICAL_PRODUCTION_ORIGIN = 'https://aimani.ai'

/** Canonical app URL for auth redirects (env → production default → Vercel → request → localhost). */
export function getSiteUrl(fallbackOrigin?: string): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
  if (fromEnv) return fromEnv

  if (fallbackOrigin) {
    const normalized = normalizeOrigin(fallbackOrigin)
    if (normalized.includes('aimani.ai')) return CANONICAL_PRODUCTION_ORIGIN
    return normalized
  }

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`

  return 'http://localhost:3000'
}

export function normalizeOrigin(origin: string): string {
  try {
    const u = new URL(origin)
    if (u.hostname === 'www.aimani.ai') {
      return CANONICAL_PRODUCTION_ORIGIN
    }
    return origin.replace(/\/$/, '')
  } catch {
    return origin.replace(/\/$/, '')
  }
}

export function isAllowedAppHost(host: string): boolean {
  const h = host.toLowerCase()
  if (LOCAL_HOSTS.has(h) || PRODUCTION_HOSTS.has(h)) return true
  if (h.endsWith('.vercel.app')) return true
  return false
}

/** Share auth cookies across www and apex on aimani.ai */
export function cookieDomainForHost(host: string): string | undefined {
  const h = host.toLowerCase()
  if (h === 'aimani.ai' || h === 'www.aimani.ai') {
    return '.aimani.ai'
  }
  return undefined
}

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

  const domain = cookieDomainForHost(host)

  return {
    ...options,
    path: '/',
    sameSite: 'lax' as const,
    secure,
    ...(domain ? { domain } : {}),
  }
}
