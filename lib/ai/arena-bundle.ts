import { createHmac, timingSafeEqual } from 'crypto'

/** Rounds 4–6 × (left champ + co-fighter + right champ). */
export const ARENA_FINAL_BUNDLE_MODEL_CALLS = 9

/** Rounds 7–9 — same call pattern as final bundle. */
export const ARENA_EXTENDED_BUNDLE_MODEL_CALLS = 9

/** Flat unlock cost for rounds 4–6 (one purchase per session). */
export function arenaFinalBundleCreditCost(): number {
  return 6
}

/** Flat unlock cost for rounds 7–9 (second continue; requires final bundle). */
export function arenaExtendedBundleCreditCost(): number {
  return 6
}

function arenaBundleSecret(): string {
  return (
    process.env.ARENA_FINAL_BUNDLE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'arena-final-bundle-dev'
  )
}

export function signArenaFinalBundleToken(opts: { sessionId: string; userId: string }): string {
  const payloadObj = {
    sid: opts.sessionId,
    uid: opts.userId,
    k: 'arena_final_456',
    v: 1,
  }
  const payload = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url')
  const sig = createHmac('sha256', arenaBundleSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function signArenaExtendedBundleToken(opts: { sessionId: string; userId: string }): string {
  const payloadObj = {
    sid: opts.sessionId,
    uid: opts.userId,
    k: 'arena_extended_789',
    v: 1,
  }
  const payload = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url')
  const sig = createHmac('sha256', arenaBundleSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function verifyArenaBundleTokenInner(
  raw: string | undefined,
  sessionId: string,
  userId: string,
  expectedKey: string
): boolean {
  if (!raw?.includes('.')) return false
  const i = raw.lastIndexOf('.')
  const payload = raw.slice(0, i)
  const sig = raw.slice(i + 1)
  if (!payload || !sig) return false
  const expected = createHmac('sha256', arenaBundleSecret()).update(payload).digest('base64url')
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    if (!timingSafeEqual(a, b)) return false
  } catch {
    return false
  }
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8')
    const o = JSON.parse(json) as { sid?: string; uid?: string; k?: string }
    return o.sid === sessionId && o.uid === userId && o.k === expectedKey
  } catch {
    return false
  }
}

/** Verifies bundle token matches session + user (single purchase unlocks rounds 4–6). */
export function verifyArenaFinalBundleToken(
  raw: string | undefined,
  sessionId: string,
  userId: string
): boolean {
  return verifyArenaBundleTokenInner(raw, sessionId, userId, 'arena_final_456')
}

/** Verifies extended bundle (purchase unlocks rounds 7–9). */
export function verifyArenaExtendedBundleToken(
  raw: string | undefined,
  sessionId: string,
  userId: string
): boolean {
  return verifyArenaBundleTokenInner(raw, sessionId, userId, 'arena_extended_789')
}
