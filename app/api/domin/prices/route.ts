import { getPrices } from '@/lib/jeju/prices'
import { createDebugSink, isDebugRequested } from '@/lib/jeju/debug-capture'

export const runtime = 'nodejs'
// 40s (was 30s) — upstream timeout is now 15s w/ 1 retry (~31s worst case).
export const maxDuration = 40

// ─────────────────────────────────────────────────────────────────────────────
// Jeju daily prices — 도민(resident) mode 물가·생활 chip.
// GET /api/domin/prices → groups (농산물/수산물/가공축산) + Perplexity context.
// KAMIS dailySalesList via reused connector allowlist + filterKamisJejuItems.
// Failure degrades gracefully; never throws.
//
// TEMPORARY: ?debug=1 adds `_debug` with raw KAMIS request/response (key
// redacted) + raw KAMIS price items. ?debug=1&forceFallback=1 additionally
// skips KAMIS entirely and captures the raw Perplexity fallback text + the
// items its parser produced. Plain requests are completely unaffected.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const debugEnabled = isDebugRequested(url)
  const debugSink = createDebugSink(debugEnabled)
  // Diagnostic-only: only honored alongside ?debug=1 — plain requests unaffected.
  const forceFallback = debugEnabled && url.searchParams.get('forceFallback') === '1'

  try {
    const result = await getPrices(debugSink, forceFallback)
    const withDebug = debugSink.enabled ? { ...result, _debug: debugSink.entries } : result
    if (!result.ok) {
      return Response.json(withDebug, { status: 502 })
    }
    return Response.json(withDebug, { status: 200 })
  } catch (e: unknown) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Prices fetch failed',
        ...(debugSink.enabled ? { _debug: debugSink.entries } : {}),
      },
      { status: 500 },
    )
  }
}
