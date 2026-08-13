import 'server-only'
import { NextResponse } from 'next/server'

/**
 * Constant-time string compare (pure JS — no Node crypto, Edge-safe). Mirrors
 * lib/middleware/route-lock.ts's safeEqual so the cron routes don't pull the
 * Edge-runtime middleware module into a nodejs route.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Verifies the Vercel cron Authorization header against CRON_SECRET.
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` when the cron entry is
 * configured with an auth secret (Vercel Pro+). Returns a 401 NextResponse on
 * mismatch, 503 when CRON_SECRET is not configured, or null when authorized.
 */
export function verifyCronAuth(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret || !secret.trim()) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  const authHeader = req.headers.get('authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!bearer || !safeEqual(bearer, secret.trim())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
