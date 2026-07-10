import { getTransport, type TransportType } from '@/lib/jeju/transport'

export const runtime = 'nodejs'
// 60s (was 30s) — bus runs sequentially before airport/ferry/context, and
// airport/ferry each resolve a list THEN fan out; with the 15s timeout + 1
// retry per call this multi-stage flow needs more headroom than a single call.
export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// SHARED Jeju transport — 도민(resident) mode.
// GET ?type=departure|arrival|both&nodeId=&lat=&lng=
//   → bus (실시간) / airport (departures+arrivals) / ferry / context.
// Pure server-side proxy over TAGO (버스·국내항공·국내선박) + Perplexity enrichment.
// No Supabase / synod / credit path. Partial upstream failures degrade to []
// sections + errors[]; airport/ferry failure triggers a Perplexity fallback.
// ─────────────────────────────────────────────────────────────────────────────

function parseType(v: string | null): TransportType {
  if (v === 'departure' || v === 'arrival' || v === 'both') return v
  return 'both'
}

function parseNum(v: string | null): number | null {
  if (v == null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)

  try {
    const result = await getTransport({
      type: parseType(url.searchParams.get('type')),
      nodeId: url.searchParams.get('nodeId'),
      lat: parseNum(url.searchParams.get('lat')),
      lng: parseNum(url.searchParams.get('lng')),
    })
    if (!result.ok) {
      return Response.json(result, { status: 502 })
    }
    return Response.json(result, { status: 200 })
  } catch (e: unknown) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Transport fetch failed',
      },
      { status: 500 },
    )
  }
}
