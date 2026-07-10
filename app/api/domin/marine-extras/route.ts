import { getMarineDisplayExtras } from '@/lib/jeju/haenyeo-marine'
import { createDebugSink, isDebugRequested } from '@/lib/jeju/debug-capture'

export const runtime = 'nodejs'
export const maxDuration = 30
export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────────────────────
// DISPLAY-ONLY 수온/조석 (KHOA), shared by chips that want haenyeo's data
// without haenyeo's wave/warnings/verdict/AI pipeline — currently the fishing
// chip's "바다 안전" fact grid. Deliberately separate from
// /api/domin/fishing-decision/* (start/status/lib/jeju/fishing-decision.ts) —
// this route is NEVER read by the go/no-go verdict or safety floor.
// GET ?spot=이호테우|함덕|협재|중문|표선|신양섭지…
// Realtime upstream data — never cached (no-store).
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const spot = url.searchParams.get('spot')
  const debugSink = createDebugSink(isDebugRequested(url))

  try {
    const extras = await getMarineDisplayExtras(spot, debugSink)
    const body = { ok: true as const, ...extras, ...(debugSink.enabled ? { _debug: debugSink.entries } : {}) }
    return Response.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } })
  } catch (e: unknown) {
    // getMarineDisplayExtras never throws; this is a last-resort safety net.
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Marine extras fetch failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
