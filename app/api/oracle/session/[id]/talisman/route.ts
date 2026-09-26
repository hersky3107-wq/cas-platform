/**
 * GET /api/oracle/session/[id]/talisman — on-demand computeTalisman.
 *
 * Reads stored oracle_computations.result (not axis votes). Does not persist.
 * Does not charge credits. Does not create a session kind.
 */
import { NextResponse } from 'next/server'
import { specFromComputation, talismanStats } from '@/app/modes/oracle/talisman-preview/from-computation'
import { talismanFromStoredSession } from '@/lib/oracle/talisman'
import type { TalismanPurpose } from '@/lib/oracle/talisman'
import { createSupabaseRunnerStore } from '@/lib/oracle/runner/store'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PURPOSES: readonly TalismanPurpose[] = ['wealth', 'love', 'promotion', 'health', 'exorcism']

function parsePurpose(raw: string | null): TalismanPurpose | null {
  if (!raw) return null
  return (PURPOSES as readonly string[]).includes(raw) ? (raw as TalismanPurpose) : null
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const missing = missingSupabaseEnv()
    if (missing) {
      return NextResponse.json({ error: `Server misconfigured: missing ${missing}` }, { status: 503 })
    }

    const { user, error: authErr } = await resolveRouteAuth(req)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const { id } = await params
    const purpose = parsePurpose(new URL(req.url).searchParams.get('purpose'))
    const store = createSupabaseRunnerStore()
    const session = await store.getSession(id)
    if (!session || session.user_id !== user.id) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const [computations, consensus] = await Promise.all([
      store.listComputations(session.id),
      store.getConsensus(session.id),
    ])

    const result = talismanFromStoredSession({
      session,
      computations,
      deficiency: consensus?.deficiency_vector ?? null,
      purpose,
    })

    if (!result.computation) {
      return NextResponse.json({
        ok: false,
        reason: result.reason,
        arrival: result.arrival,
      })
    }

    const spec = specFromComputation(result.computation, result.charts, {
      sessionId: session.id,
      dateLabel: session.created_at.slice(0, 10).replaceAll('-', '.'),
      title: 'session',
      note: `${result.computation.centre.source} · ${result.computation.centre.mode}`,
    })

    return NextResponse.json({
      ok: true,
      sessionId: session.id,
      purpose,
      computation: result.computation,
      spec,
      stats: talismanStats(result.computation),
      arrival: result.arrival,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
