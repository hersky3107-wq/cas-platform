import { getWelfare } from '@/lib/gunpo/resident/welfare'

export const runtime = 'nodejs'
export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// Gunpo 복지·행정 — 마감 임박 공고. Cloned from app/api/domin/welfare.
// GET /api/gunpo/resident/welfare → { deadlineSoon[], contextMeta, disclaimer, ... }
// Merged 보조금24 + 군포 공고, CODE-level deadline cut, today→+30d ascending.
// One build per KST day (gunpo_welfare_cache, degrades to no-cache if the
// table doesn't exist yet). Query: ?force=1 bypasses cache (non-prod, or
// GUNPO_WELFARE_CACHE_FORCE_KEY match). Never throws upstream.
// ─────────────────────────────────────────────────────────────────────────────

function allowForce(url: URL): boolean {
  if (url.searchParams.get('force') !== '1') return false
  if (process.env.NODE_ENV !== 'production') return true
  const expected = process.env.GUNPO_WELFARE_CACHE_FORCE_KEY
  if (!expected) return false
  return url.searchParams.get('key') === expected
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const force = allowForce(url)
  try {
    const result = await getWelfare({ force })
    if (!result.ok) return Response.json(result, { status: 502 })
    return Response.json(result, { status: 200 })
  } catch (e: unknown) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Welfare fetch failed' },
      { status: 500 },
    )
  }
}
