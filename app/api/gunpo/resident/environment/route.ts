import { NextResponse } from 'next/server'

import { getEnvironment } from '@/lib/gunpo/resident/environment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/gunpo/resident/environment — 시민 환경 chip. Cloned from
 * app/api/domin/environment, but scoped down to AirKorea(군포 측정소) only
 * (클린하우스/배출요일제/Q&A were not ported — see STEP3 scope).
 * Returns { dust, freshnessNote, updatedAt, errors }.
 * Pure proxy; never throws — sections degrade to null with errors[].
 */
export async function GET() {
  try {
    const result = await getEnvironment()
    return NextResponse.json(result, { status: 200 })
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    )
  }
}
