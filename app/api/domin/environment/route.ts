import { NextResponse } from 'next/server'

import { getEnvironment } from '@/lib/jeju/environment'
import { createDebugSink, isDebugRequested } from '@/lib/jeju/debug-capture'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/domin/environment — 도민 배출·환경 chip.
 * Query: lat, lng (optional → nearest N centers), limit (optional).
 * Returns { dust, centers, context, contextMeta, freshnessNote, updatedAt, errors }.
 * Pure proxy; never throws — sections degrade to null with errors[].
 *
 * TEMPORARY: ?debug=1 adds `_debug` with the raw AirKorea (dust) upstream
 * request/response (key redacted). No effect on production behavior otherwise.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const { searchParams } = url
  const latRaw = searchParams.get('lat')
  const lngRaw = searchParams.get('lng')
  const limitRaw = searchParams.get('limit')

  const lat = latRaw != null && latRaw.trim() !== '' ? Number(latRaw) : null
  const lng = lngRaw != null && lngRaw.trim() !== '' ? Number(lngRaw) : null
  const limit = limitRaw != null && limitRaw.trim() !== '' ? Number(limitRaw) : undefined

  const debugSink = createDebugSink(isDebugRequested(url))

  try {
    const result = await getEnvironment(
      {
        lat: Number.isFinite(lat as number) ? lat : null,
        lng: Number.isFinite(lng as number) ? lng : null,
        limit: Number.isFinite(limit as number) ? limit : undefined,
      },
      debugSink,
    )
    return NextResponse.json(
      debugSink.enabled ? { ...result, _debug: debugSink.entries } : result,
      { status: 200 },
    )
  } catch (e: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        ...(debugSink.enabled ? { _debug: debugSink.entries } : {}),
      },
      { status: 200 },
    )
  }
}
