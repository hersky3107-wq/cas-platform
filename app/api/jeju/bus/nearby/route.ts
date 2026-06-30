import { getNearbyStations } from '@/lib/jeju/bus'

export const runtime = 'nodejs'
export const maxDuration = 20

// ─────────────────────────────────────────────────────────────────────────────
// Shared Jeju bus — nearby stations by coordinate.
// POST { lat, lng } → { ok, data: BusStation[] } | { ok:false, error }.
// Pure server-side proxy over TAGO; the serviceKey never reaches the client.
// No Supabase / synod / credit path.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body tolerated; validated below
  }

  const lat = typeof body.lat === 'number' ? body.lat : parseFloat(String(body.lat ?? ''))
  const lng = typeof body.lng === 'number' ? body.lng : parseFloat(String(body.lng ?? ''))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ ok: false, error: 'Invalid coordinates' }, { status: 400 })
  }

  const result = await getNearbyStations(lat, lng)
  return Response.json(result, { status: result.ok ? 200 : 502 })
}
