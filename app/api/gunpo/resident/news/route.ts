import { getNews } from '@/lib/gunpo/resident/news'

export const runtime = 'nodejs'
export const maxDuration = 30

// ─────────────────────────────────────────────────────────────────────────────
// Gunpo local-news briefing — 시민(resident) mode. Cloned from app/api/domin/news.
// GET /api/gunpo/resident/news → briefing[] + contextMeta (🔍 검색).
// One Perplexity call per KST day (gunpo_news_cache, degrades to no-cache if
// the table doesn't exist yet); later hits reuse cache.
// Query: ?force=1 bypasses cache (non-prod, or GUNPO_NEWS_CACHE_FORCE_KEY match).
// ─────────────────────────────────────────────────────────────────────────────

function allowForce(url: URL): boolean {
  if (url.searchParams.get('force') !== '1') return false
  if (process.env.NODE_ENV !== 'production') return true
  const expected = process.env.GUNPO_NEWS_CACHE_FORCE_KEY
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
      { ok: false, error: e instanceof Error ? e.message : 'News briefing fetch failed' },
      { status: 500 },
    )
  }
}
