import { getEvents } from '@/lib/gunpo/resident/events'

export const runtime = 'nodejs'
export const maxDuration = 45

// ─────────────────────────────────────────────────────────────────────────────
// Gunpo 축제·행사 (events, RESIDENT lens) — 시민(resident) mode. Cloned from
// app/api/domin/events.
// GET /api/gunpo/resident/events → grouped events (오늘 → +14일) + contextMeta.
// STEP5: source is Perplexity search (군포시청 공식 행사·축제 안내) only —
// the earlier 문화정보원 XML integration was discarded. One build per KST
// day (gunpo_events_cache, degrades to no-cache if the table doesn't exist).
// Query: ?force=1 bypasses cache (non-prod, or GUNPO_EVENTS_CACHE_FORCE_KEY match).
// ─────────────────────────────────────────────────────────────────────────────

function allowForce(url: URL): boolean {
  if (url.searchParams.get('force') !== '1') return false
  if (process.env.NODE_ENV !== 'production') return true
  const expected = process.env.GUNPO_EVENTS_CACHE_FORCE_KEY
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
