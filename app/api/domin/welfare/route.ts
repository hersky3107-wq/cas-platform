import { getWelfare } from '@/lib/jeju/welfare'

export const runtime = 'nodejs'
export const maxDuration = 45

// ─────────────────────────────────────────────────────────────────────────────
// 도민(resident) 복지·행정 — 마감 임박 공고 (deadline-soon calendar).
// GET /api/domin/welfare → { deadlineSoon[], contextMeta, disclaimer, ... }
// Merged 보조금24 + 제주 3청 공고, CODE-level deadline cut (< today dropped),
// today→+30d sorted ascending. One build per KST day (jeju_welfare_cache).
// Query: ?force=1 bypasses cache (non-prod, or WELFARE_CACHE_FORCE_KEY match).
// Never throws upstream; degrades to empty list + errors[].
// ─────────────────────────────────────────────────────────────────────────────

function allowForce(url: URL): boolean {
  if (url.searchParams.get('force') !== '1') return false
  if (process.env.NODE_ENV !== 'production') return true
  const expected = process.env.WELFARE_CACHE_FORCE_KEY
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
