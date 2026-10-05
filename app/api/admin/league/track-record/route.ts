import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { loadConsensusTrackRecord } from '@/lib/league/consensus-record-summary'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden
  try {
    const cells = await loadConsensusTrackRecord()
    return NextResponse.json({ cells })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load track record' },
      { status: 500 },
    )
  }
}
