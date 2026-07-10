import { getWeatherAlert } from '@/lib/jeju/weather-alert'

export const runtime = 'nodejs'
// 45s (was 30s) — upstream per-call timeout is now 15s w/ 1 retry; give headroom
// for the short/mid-forecast + warnings sections.
export const maxDuration = 45

// ─────────────────────────────────────────────────────────────────────────────
// SHARED Jeju weather & disaster alert — 도민(resident) mode.
// GET ?region=제주시|서귀포 → today / tomorrow / week / warnings / context.
// Pure server-side proxy over data.go.kr (단기예보 + 중기예보 + 기상특보) with
// mandatory Perplexity enrichment. No Supabase / synod / credit path.
// Partial upstream failures degrade to null sections + errors[].
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const region = url.searchParams.get('region')

  try {
    const result = await getWeatherAlert(region)
    if (!result.ok) {
      return Response.json(result, { status: 502 })
    }
    return Response.json(result, { status: 200 })
  } catch (e: unknown) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Weather alert fetch failed',
      },
      { status: 500 },
    )
  }
}
