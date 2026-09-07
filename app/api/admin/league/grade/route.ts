import { NextResponse } from 'next/server'
import { requireAdmin, ADMIN_EMAIL } from '@/lib/admin/require-admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { listOperatorGradeQueue } from '@/lib/prediction/operator-queue'
import { gradeRoundFromOperatorEvidence } from '@/lib/prediction/operator-grade-live'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden
  try {
    const rounds = await listOperatorGradeQueue()
    return NextResponse.json({ rounds })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load operator grade queue' },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden

  const gradedBy = await getAdminUserId(req)
  if (!gradedBy) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const roundId = typeof (body as { roundId?: unknown }).roundId === 'string' ? (body as { roundId: string }).roundId : ''
  const sourceUrl =
    typeof (body as { sourceUrl?: unknown }).sourceUrl === 'string' ? (body as { sourceUrl: string }).sourceUrl : ''
  const observedFact =
    typeof (body as { observedFact?: unknown }).observedFact === 'string'
      ? (body as { observedFact: string }).observedFact
      : ''

  if (!roundId) return NextResponse.json({ error: 'roundId is required' }, { status: 400 })

  const result = await gradeRoundFromOperatorEvidence({
    roundId,
    sourceUrl,
    observedFact,
    gradedBy,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({
    ok: true,
    derived_side: result.derived_side,
    children_graded: result.children_graded,
    actual_outcome: result.actual_outcome,
  })
}

async function getAdminUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined
  let jwt = bearer
  if (!jwt) {
    const { createSupabaseRouteAuthClient } = await import('@/lib/supabase/route-auth')
    const authClient = await createSupabaseRouteAuthClient(req)
    const {
      data: { session },
    } = await authClient.auth.getSession()
    jwt = session?.access_token
  }
  if (!jwt) return null
  const { data, error } = await supabaseAdmin.auth.getUser(jwt)
  if (error || !data.user?.id) return null
  if (!data.user.email || data.user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return null
  return data.user.id
}
