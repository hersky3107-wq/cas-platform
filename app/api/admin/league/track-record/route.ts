import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { loadConsensusTrackRecord, loadLensEraComparison } from '@/lib/league/consensus-record-summary'
import { loadReplayAdmin } from '@/lib/league/extra/lesson-notes.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden
  try {
    const cells = await loadConsensusTrackRecord()
    const replay = await loadReplayAdmin().catch(() => ({ cells: [], costs: [] }))
    const lensEras = await loadLensEraComparison().catch(() => [])
    return NextResponse.json({ cells, replay, lensEras })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load track record' },
      { status: 500 },
    )
  }
}
