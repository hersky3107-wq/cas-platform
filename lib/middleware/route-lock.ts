import type { NextRequest, NextResponse } from 'next/server'

/** HttpOnly cookie set after a valid ?k= bypass; presence alone grants access. */
export const LOCK_BYPASS_COOKIE = 'lock_bypass'
const LOCK_BYPASS_COOKIE_VALUE = '1'

function isEnvLockOn(envValue: string | undefined): boolean {
  return envValue === '1'
}

function isCarePath(pathname: string): boolean {
  return (
    pathname === '/care' ||
    pathname.startsWith('/care/') ||
    pathname === '/api/care' ||
    pathname.startsWith('/api/care/')
  )
}

function isJejuPath(pathname: string): boolean {
  return (
    pathname === '/jeju' ||
    pathname.startsWith('/jeju/') ||
    pathname === '/api/jeju' ||
    pathname.startsWith('/api/jeju/')
  )
}

function isPathLocked(pathname: string): boolean {
  if (isCarePath(pathname) && isEnvLockOn(process.env.LOCK_CARE)) return true
  if (isJejuPath(pathname) && isEnvLockOn(process.env.LOCK_JEJU)) return true
  return false
}

function hasBypassCookie(request: NextRequest): boolean {
  return request.cookies.get(LOCK_BYPASS_COOKIE)?.value === LOCK_BYPASS_COOKIE_VALUE
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function queryBypassValid(request: NextRequest): boolean {
  const expected = process.env.LOCK_BYPASS_TOKEN
  if (!expected) return false
  const provided = request.nextUrl.searchParams.get('k')
  if (!provided) return false
  return safeEqual(provided, expected)
}

export type RouteLockDecision =
  | { action: 'pass' }
  | { action: 'pass_set_bypass' }
  | { action: 'block' }

/**
 * Evaluates whether a request to a /care or /jeju (page or API) prefix should
 * be blocked. Only runs when the corresponding LOCK_* env is "1".
 */
export function evaluateRouteLock(request: NextRequest): RouteLockDecision {
  if (!isPathLocked(request.nextUrl.pathname)) {
    return { action: 'pass' }
  }

  if (hasBypassCookie(request)) {
    return { action: 'pass' }
  }

  if (queryBypassValid(request)) {
    return { action: 'pass_set_bypass' }
  }

  return { action: 'block' }
}

/** Sets the HttpOnly bypass cookie on an outgoing middleware response. */
export function attachBypassCookie(response: NextResponse): void {
  response.cookies.set(LOCK_BYPASS_COOKIE, LOCK_BYPASS_COOKIE_VALUE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
}

/** Opaque 404 — no redirect, does not reveal that the route exists. */
export function routeLockBlockedResponse(): Response {
  return new Response(null, { status: 404 })
}
