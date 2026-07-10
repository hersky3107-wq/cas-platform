import { getMarineData } from '@/lib/jeju/marine'
import { createDebugSink, isDebugRequested } from '@/lib/jeju/debug-capture'

export const runtime = 'nodejs'
// 45s (was 30s) — upstream per-call timeout is now 15s w/ 1 retry (~31s worst
// per section); Promise.allSettled sections run concurrently, so this covers it.
export const maxDuration = 45

// ─────────────────────────────────────────────────────────────────────────────
// SHARED Jeju marine data — 도민 일반 mode.
// GET ?spot=이호테우|함덕|348… → tide / wave / waterTemp / sun / warnings.
// Pure server-side proxy over data.go.kr (BeachInfoservice + getWthrWrnList).
// No Supabase / synod / credit path. Partial upstream failures degrade to
// null sections + errors[] rather than failing the whole response.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const spot = url.searchParams.get('spot')
  const debugSink = createDebugSink(isDebugRequested(url))

  try {
    const result = await getMarineData(spot, debugSink)
    const withDebug = debugSink.enabled ? { ...result, _debug: debugSink.entries } : result
    if (!result.ok) {
      return Response.json(withDebug, { status: 502 })
    }
    return Response.json(withDebug, { status: 200 })
  } catch (e: unknown) {
    // getMarineData never throws; this is a last-resort safety net.
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Marine data fetch failed',
        ...(debugSink.enabled ? { _debug: debugSink.entries } : {}),
      },
      { status: 500 },
    )
  }
}
