import {
  getVisitJejuPool,
  fetchVisitJejuPlaces,
  pickFeaturedVisitJejuPlaces,
  toVisitJejuLocale,
  FEATURED_BUCKET_TARGETS,
  type VisitJejuPlace,
} from '@/lib/jeju/connectors'
import { normalizeAiLocale } from '@/lib/jeju/ai-locale'

export const runtime = 'nodejs'
// Give headroom for 15s-timeout pool fetch + fallback + 1s wait + one retry (worst-case ~46s).
export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// JEJU "지금 뜨는 제주" featured section — locale-aware random sample.
// The page server-renders the Korean (kr) set; the client calls this route when
// a non-Korean UI locale is active to get the SAME randomized/varied selection
// but from VisitJeju's native multilingual pool (cached per locale in connectors).
// ─────────────────────────────────────────────────────────────────────────────

const FEATURED_COUNT = 8

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body tolerated → defaults to Korean
  }

  const vjLocale = toVisitJejuLocale(normalizeAiLocale(body.locale))

  let pool = await getVisitJejuPool(vjLocale)
  if (pool.length === 0) {
    const fallback = await fetchVisitJejuPlaces({
      perCategory: 20,
      categories: ['c1', 'c4', 'c5', 'c2', 'c6'],
      locale: vjLocale,
    })
    pool = fallback.ok ? fallback.places : []
  }

  let places: VisitJejuPlace[] = pickFeaturedVisitJejuPlaces(pool, {
    count: FEATURED_COUNT,
    bucketTargets: FEATURED_BUCKET_TARGETS,
  })

  // Both pool and fallback returned nothing — retry once after a short delay.
  if (places.length === 0) {
    await new Promise<void>((r) => setTimeout(r, 1_000))
    const retry = await fetchVisitJejuPlaces({
      perCategory: 20,
      categories: ['c1', 'c4', 'c5', 'c2', 'c6'],
      locale: vjLocale,
    })
    const retryPool = retry.ok ? retry.places : []
    places = pickFeaturedVisitJejuPlaces(retryPool, {
      count: FEATURED_COUNT,
      bucketTargets: FEATURED_BUCKET_TARGETS,
    })
  }

  return Response.json({ ok: true, places })
}
