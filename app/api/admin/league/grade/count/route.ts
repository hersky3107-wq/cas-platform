import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { countNeedsGrading } from '@/lib/league/manual-grade'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden
  try {
    const pendingCount = await countNeedsGrading()
    return NextResponse.json({ pendingCount })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to count pending grades' },
      { status: 500 }
    )
  }
}
