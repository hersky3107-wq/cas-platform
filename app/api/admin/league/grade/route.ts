import { after, NextResponse } from 'next/server'
import { requireAdmin, requireAdminUser } from '@/lib/admin/require-admin'
import { refreshLeaderboardCacheQuietly } from '@/lib/league/boards/cache.server'
import { applyManualGrade, applyManualGradesBulk, countNeedsGrading, listNeedsGradingQueue } from '@/lib/league/manual-grade'
import { readApiFootballUsageToday } from '@/lib/league/sports/api-football'
import { isManualVerdict, type BulkGradeItem } from '@/lib/league/manual-grade/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden
  try {
    const [rounds, pendingCount, apiFootballUsage] = await Promise.all([
      listNeedsGradingQueue(),
      countNeedsGrading(),
      readApiFootballUsageToday().catch(() => ({ day: new Date().toISOString().slice(0, 10), requestCount: 0 })),
    ])
    return NextResponse.json({ rounds, pendingCount, apiFootballUsage })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load grading queue' },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  const admin = await requireAdminUser(req)
  if ('response' in admin) return admin.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const rec = body as Record<string, unknown>

  if (rec.action === 'bulk') {
    const rawItems = Array.isArray(rec.items) ? rec.items : []
    const items: BulkGradeItem[] = []
    for (const item of rawItems) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      if (typeof row.roundId !== 'string' || !isManualVerdict(row.verdict)) continue
      items.push({
        roundId: row.roundId,
        verdict: row.verdict,
        evidenceUrl: typeof row.evidenceUrl === 'string' ? row.evidenceUrl : '',
        note: typeof row.note === 'string' ? row.note : '',
      })
    }
    if (items.length === 0) {
      return NextResponse.json({ error: 'items must contain at least one yes/no/void row' }, { status: 400 })
    }
    const result = await applyManualGradesBulk(items, admin.userId)
    after(() => refreshLeaderboardCacheQuietly('manual grade batch'))
    return NextResponse.json(result)
  }

  const roundId = typeof rec.roundId === 'string' ? rec.roundId : ''
  if (!roundId) return NextResponse.json({ error: 'roundId is required' }, { status: 400 })
  if (!isManualVerdict(rec.verdict)) {
    return NextResponse.json({ error: 'verdict must be yes, no, or void' }, { status: 400 })
  }

  const result = await applyManualGrade({
    roundId,
    verdict: rec.verdict,
    gradedBy: admin.userId,
    evidenceUrl: typeof rec.evidenceUrl === 'string' ? rec.evidenceUrl : '',
    note: typeof rec.note === 'string' ? rec.note : '',
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  after(() => refreshLeaderboardCacheQuietly('manual grade'))
  return NextResponse.json(result)
}
