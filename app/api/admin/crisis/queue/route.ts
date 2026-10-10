import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/admin/require-admin'
import { enqueueRegion, enqueueRunAll, estimateQueueUsd, isQueueScope, regionsForRunAll } from '@/lib/crisis/admin/queue'
import { loadTodayRegions } from '@/lib/crisis/admin/store'
import { RUN_ALL_MIN_STAGE, type QueueScope } from '@/lib/crisis/admin/types'
import { supabaseAdmin } from '@/lib/supabase/server'

const FORCE_FRESH = 'force:fresh'

type AdminQueueInsert = {
  region_id: number | null
  scope: QueueScope
  requested_by: string
  status: 'queued'
  error: string | null
}

function adminQueueRow(
  row: { region_id: number | null; scope: QueueScope; requested_by: string | null; status: 'queued' },
  force: boolean,
): AdminQueueInsert {
  if (!row.requested_by) throw new Error('requested_by is required')
  return {
    region_id: row.region_id,
    scope: row.scope,
    requested_by: row.requested_by,
    status: 'queued',
    error: force ? FORCE_FRESH : null,
  }
}

async function insertAdminQueueRows(rows: AdminQueueInsert[]) {
  if (rows.length === 0) return []
  const { data, error } = await supabaseAdmin
    .from('crisis_engine_requests')
    .insert(rows)
    .select('id,region_id,scope,requested_by,status,run_id,error,created_at,started_at,finished_at')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function POST(req: Request) {
  const auth = await requireAdminUser(req)
  if ('response' in auth) return auth.response

  let body: { scope?: unknown; regionId?: unknown; force?: unknown }
  try {
    body = (await req.json()) as { scope?: unknown; regionId?: unknown; force?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!isQueueScope(body.scope)) {
    return NextResponse.json({ error: 'scope must be region or all' }, { status: 400 })
  }

  const forceFresh = body.force !== false

  try {
    if (body.scope === 'region') {
      const regionId = typeof body.regionId === 'number' ? body.regionId : Number(body.regionId)
      const inserted = await insertAdminQueueRows([adminQueueRow(enqueueRegion(regionId, auth.userId), forceFresh)])
      return NextResponse.json({ ok: true, inserted, force: forceFresh, estimateUsd: estimateQueueUsd(1) })
    }

    const today = await loadTodayRegions(supabaseAdmin)
    const picked = regionsForRunAll(today.regions, RUN_ALL_MIN_STAGE)
    const rows = enqueueRunAll(
      picked.map((row) => row.regionId),
      auth.userId,
    ).map((row) => adminQueueRow(row, forceFresh))
    const inserted = await insertAdminQueueRows(rows)
    return NextResponse.json({
      ok: true,
      inserted,
      force: forceFresh,
      count: picked.length,
      estimateUsd: estimateQueueUsd(picked.length),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not enqueue'
    const status = /region_id is required/.test(message) ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
