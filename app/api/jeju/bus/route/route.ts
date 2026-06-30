import { searchRouteByNumber } from '@/lib/jeju/bus'

export const runtime = 'nodejs'
export const maxDuration = 25

// ─────────────────────────────────────────────────────────────────────────────
// Shared Jeju bus — search a route by number → ordered stop list.
// POST { routeNo } → { ok, data: BusRoute } | { ok:false, error }.
// error 'NO_ROUTE' = no Jeju route matched that number. Server-only proxy.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body tolerated; validated below
  }

  const routeNo = typeof body.routeNo === 'string' ? body.routeNo.trim() : String(body.routeNo ?? '').trim()
  if (!routeNo) {
    return Response.json({ ok: false, error: 'Missing route number' }, { status: 400 })
  }

  const result = await searchRouteByNumber(routeNo)
  const status = result.ok ? 200 : result.error === 'NO_ROUTE' ? 404 : 502
  return Response.json(result, { status })
}
