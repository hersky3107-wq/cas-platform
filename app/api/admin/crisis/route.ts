import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { ESTIMATE_USD_PER_REGION, RUN_ALL_MIN_STAGE } from '@/lib/crisis/admin/types'
import { estimateQueueUsd, groupQueue, regionsForRunAll } from '@/lib/crisis/admin/queue'
import { loadQueue, loadTodayRegions } from '@/lib/crisis/admin/store'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden
  try {
    const [today, queue] = await Promise.all([loadTodayRegions(supabaseAdmin), loadQueue(supabaseAdmin)])
    const runAll = regionsForRunAll(today.regions, RUN_ALL_MIN_STAGE)
    return NextResponse.json({
      day: today.day,
      regions: today.regions,
      queue,
      grouped: groupQueue(queue),
      runAllCount: runAll.length,
      estimateUsdPerRegion: ESTIMATE_USD_PER_REGION,
      runAllEstimateUsd: estimateQueueUsd(runAll.length),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load CrisisWatch admin'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
