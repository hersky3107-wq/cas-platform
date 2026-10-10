import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/admin/require-admin'
import { enqueueRegion, enqueueRunAll, estimateQueueUsd, isQueueScope, regionsForRunAll } from '@/lib/crisis/admin/queue'
import { insertQueueRows, loadTodayRegions } from '@/lib/crisis/admin/store'
import { RUN_ALL_MIN_STAGE } from '@/lib/crisis/admin/types'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const auth = await requireAdminUser(req)
  if ('response' in auth) return auth.response

  let body: { scope?: unknown; regionId?: unknown }
  try {
    body = (await req.json()) as { scope?: unknown; regionId?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!isQueueScope(body.scope)) {
    return NextResponse.json({ error: 'scope must be region or all' }, { status: 400 })
  }

  try {
    if (body.scope === 'region') {
      const regionId = typeof body.regionId === 'number' ? body.regionId : Number(body.regionId)
      const inserted = await insertQueueRows(supabaseAdmin, [enqueueRegion(regionId, auth.userId)])
      return NextResponse.json({ ok: true, inserted, estimateUsd: estimateQueueUsd(1) })
    }

    const today = await loadTodayRegions(supabaseAdmin)
    const picked = regionsForRunAll(today.regions, RUN_ALL_MIN_STAGE)
    const inserted = await insertQueueRows(
      supabaseAdmin,
      enqueueRunAll(
        picked.map((row) => row.regionId),
        auth.userId,
      ),
    )
    return NextResponse.json({
      ok: true,
      inserted,
      count: picked.length,
      estimateUsd: estimateQueueUsd(picked.length),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not enqueue'
    const status = /region_id is required/.test(message) ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
