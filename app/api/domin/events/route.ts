import { getEvents } from '@/lib/jeju/events'

export const runtime = 'nodejs'
export const maxDuration = 30

// ─────────────────────────────────────────────────────────────────────────────
// Jeju 축제·행사 (events, RESIDENT lens) — 도민(resident) mode.
// GET /api/domin/events → grouped events (오늘 → +14일) + contextMeta (🔍 검색).
// One merged culture-XML + Perplexity build per KST day (jeju_events_cache);
// later hits reuse cache. Query: ?force=1 bypasses cache (admin/testing —
// non-production, or when EVENTS_CACHE_FORCE_KEY is set and ?key= matches).
// Failure degrades to empty groups + errors[] (never throws upstream).
// ─────────────────────────────────────────────────────────────────────────────

function allowForce(url: URL): boolean {
  if (url.searchParams.get('force') !== '1') return false
  if (process.env.NODE_ENV !== 'production') return true
  const expected = process.env.EVENTS_CACHE_FORCE_KEY
  if (!expected) return false
  return url.searchParams.get('key') === expected
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const force = allowForce(url)

  try {
    const result = await getEvents({ force })
    if (!result.ok) {
      return Response.json(result, { status: 502 })
    }
    return Response.json(result, { status: 200 })
  } catch (e: unknown) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Events fetch failed' },
      { status: 500 },
    )
  }
}
