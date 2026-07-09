import { getNews } from '@/lib/jeju/news'

export const runtime = 'nodejs'
export const maxDuration = 30

// ─────────────────────────────────────────────────────────────────────────────
// SHARED Jeju local-news briefing — 도민(resident) mode.
// GET /api/domin/news → briefing[] + contextMeta (🔍 검색).
// One Perplexity call per KST day (jeju_news_cache); later hits reuse cache.
// Query: ?force=1 bypasses cache (admin/testing — non-production, or when
// NEWS_CACHE_FORCE_KEY is set and ?key= matches).
// Failure degrades to empty briefing + errors[] (never throws upstream).
// ─────────────────────────────────────────────────────────────────────────────

function allowForce(url: URL): boolean {
  if (url.searchParams.get('force') !== '1') return false
  if (process.env.NODE_ENV !== 'production') return true
  const expected = process.env.NEWS_CACHE_FORCE_KEY
  if (!expected) return false
  return url.searchParams.get('key') === expected
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const force = allowForce(url)

  try {
    const result = await getNews({ force })
    if (!result.ok) {
      return Response.json(result, { status: 502 })
    }
    return Response.json(result, { status: 200 })
  } catch (e: unknown) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'News briefing fetch failed',
      },
      { status: 500 },
    )
  }
}
