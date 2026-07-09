import { NextResponse } from 'next/server'

import { getEnvironment } from '@/lib/jeju/environment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/domin/environment — 도민 배출·환경 chip.
 * Query: lat, lng (optional → nearest N centers), limit (optional).
 * Returns { dust, centers, context, contextMeta, freshnessNote, updatedAt, errors }.
 * Pure proxy; never throws — sections degrade to null with errors[].
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const latRaw = searchParams.get('lat')
  const lngRaw = searchParams.get('lng')
  const limitRaw = searchParams.get('limit')

  const lat = latRaw != null && latRaw.trim() !== '' ? Number(latRaw) : null
  const lng = lngRaw != null && lngRaw.trim() !== '' ? Number(lngRaw) : null
  const limit = limitRaw != null && limitRaw.trim() !== '' ? Number(limitRaw) : undefined

  try {
    const result = await getEnvironment({
      lat: Number.isFinite(lat as number) ? lat : null,
      lng: Number.isFinite(lng as number) ? lng : null,
      limit: Number.isFinite(limit as number) ? limit : undefined,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    )
  }
}
