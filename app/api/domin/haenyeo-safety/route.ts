import { getHaenyeoSafety } from '@/lib/jeju/haenyeo-marine'
import { createDebugSink, isDebugRequested } from '@/lib/jeju/debug-capture'

export const runtime = 'nodejs'
// Mirrors /api/domin/marine's budget: 15s upstream timeout + 1 retry per
// section, 4 sections run concurrently (marine + 수온/조석/조류), plus the
// Perplexity explanation call (also 15s). Generous ceiling for worst case.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────────────────────
// 해녀 물질안전 — 도민 일반 mode.
// GET ?spot=이호테우|함덕|협재|중문|표선|신양섭지…
//   → wave/sun/warnings (from lib/jeju/marine.ts, unmodified) +
//     KHOA 수온/조석/조류 (this feature) +
//     LAYER-1 code-only safety verdict + LAYER-2 AI explanation of it.
// Realtime/daily-varying upstream data — NEVER cached (no-store everywhere).
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const spot = url.searchParams.get('spot')
  const debugSink = createDebugSink(isDebugRequested(url))

  try {
    const result = await getHaenyeoSafety(spot, debugSink)
    const withDebug = debugSink.enabled ? { ...result, _debug: debugSink.entries } : result
    return Response.json(withDebug, {
      status: result.ok ? 200 : 502,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (e: unknown) {
    // getHaenyeoSafety never throws; this is a last-resort safety net.
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Haenyeo safety fetch failed',
        ...(debugSink.enabled ? { _debug: debugSink.entries } : {}),
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
