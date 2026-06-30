import { getStationArrivals } from '@/lib/jeju/bus'

export const runtime = 'nodejs'
export const maxDuration = 20

// ─────────────────────────────────────────────────────────────────────────────
// Shared Jeju bus — real-time arrivals at a station.
// POST { nodeId } → { ok, data: BusArrival[] } | { ok:false, error }.
// An empty data array is a valid success (no imminent bus). Server-only proxy.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body tolerated; validated below
  }

  const nodeId = typeof body.nodeId === 'string' ? body.nodeId.trim() : ''
  if (!nodeId) {
    return Response.json({ ok: false, error: 'Missing nodeId' }, { status: 400 })
  }

  const result = await getStationArrivals(nodeId)
  return Response.json(result, { status: result.ok ? 200 : 502 })
}
