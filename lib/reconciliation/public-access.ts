/**
 * Contest-judging public access for /reconciliation ONLY.
 *
 * Edge-safe (no 'server-only', no supabase): middleware.ts imports this to
 * stamp the workspace cookie. Server routes import isReconPublic() from here
 * too. Switching RECONCILIATION_PUBLIC off in Vercel restores login-gated
 * behaviour — no client bundle flag (NEXT_PUBLIC would be baked at build).
 */

export const RECON_WS_COOKIE = 'recon_ws'
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isReconPublic(): boolean {
  return process.env.RECONCILIATION_PUBLIC === 'true'
}

export function isReconciliationPath(pathname: string): boolean {
  return (
    pathname === '/reconciliation' ||
    pathname.startsWith('/reconciliation/') ||
    pathname.startsWith('/api/reconciliation/')
  )
}

export function reconWsCookieOptions(): {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: '/'
  maxAge: number
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SEC,
  }
}

function hmacSecret(): string | null {
  const dedicated = process.env.RECONCILIATION_PUBLIC_SECRET?.trim()
  if (dedicated) return dedicated
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  return fallback || null
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Sign a workspace id into the cookie payload `uuid.hmac`. */
export async function signWorkspaceCookie(id: string): Promise<string | null> {
  const secret = hmacSecret()
  if (!secret || !UUID_RE.test(id)) return null
  const mac = await hmacHex(id, secret)
  return `${id}.${mac}`
}

/** Verify cookie payload; returns the workspace uuid or null. */
export async function parseWorkspaceCookie(raw: string | undefined | null): Promise<string | null> {
  if (!raw) return null
  const dot = raw.indexOf('.')
  if (dot < 0) return null
  const id = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)
  if (!UUID_RE.test(id) || !mac) return null
  const secret = hmacSecret()
  if (!secret) return null
  const expected = await hmacHex(id, secret)
  if (!safeEqual(mac, expected)) return null
  return id
}

export async function issueWorkspaceCookieValue(): Promise<string | null> {
  return signWorkspaceCookie(crypto.randomUUID())
}
