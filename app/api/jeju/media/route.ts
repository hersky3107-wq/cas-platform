import { getMediaDigest } from '@/lib/jeju/mediawatch'
import type { JejuMediaWatchMode } from '@/lib/jeju/mediawatch'

export const runtime = 'nodejs'
export const maxDuration = 60

// TODO: credit/auth gating before public launch

// ─────────────────────────────────────────────────────────────────────────────
// Daily-cached media digest (jeju_media_cache; see lib/jeju/mediawatch.ts).
// First POST of a KST day (per mode) runs the full fan-out; later POSTs the
// same day — including the page's auto-load on mount — hit the cache.
// `force:true` bypasses the cache (gated the same way domin news' `force`
// param is gated in app/api/domin/news/route.ts).
// ─────────────────────────────────────────────────────────────────────────────

function allowForce(body: Record<string, unknown>): boolean {
  if (body.force !== true) return false
  if (process.env.NODE_ENV !== 'production') return true
  const expected = process.env.MEDIA_CACHE_FORCE_KEY
  if (!expected) return false
  return body.key === expected
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body is fine — mode is optional
  }

  const mode: JejuMediaWatchMode =
    body.mode === 'resident' ? 'resident' : 'governance'
  const force = allowForce(body)

  try {
    const result = await getMediaDigest({ mode, force })
    return Response.json(result)
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'Internal error'
    return Response.json({ ok: false, error }, { status: 500 })
  }
}
