/**
 * POST /api/oracle/session/[id]/advance — run ONE chunk.
 *
 * Returns as soon as the lease is claimed. The chunk itself runs in
 * `after()`, so the AI calls survive the response and the client can go
 * offline (screen lock, tab close) without stalling the session. The cron
 * sweeper picks up anything whose worker dies mid-chunk.
 *
 * If another worker already holds the lease, this is a no-op that reports the
 * current status.
 */
import { after, NextResponse } from 'next/server'
import { createOracleAiAdapter, oracleAiAdvanceOptions } from '@/lib/oracle/ai/create-adapter'
import { advanceOracleSession } from '@/lib/oracle/runner'
import { createCreditsPort } from '@/lib/oracle/runner/credits'
import { createSupabaseRunnerStore } from '@/lib/oracle/runner/store'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

export const runtime = 'nodejs'
/** A layer-2 chunk can hold up to 9 units at 25s each; give `after()` room. */
export const maxDuration = 300

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const missing = missingSupabaseEnv()
    if (missing) {
      return NextResponse.json({ error: `Server misconfigured: missing ${missing}` }, { status: 503 })
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const { user, error: authErr } = await resolveRouteAuth(req, body ?? undefined)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const { id } = await params
    const store = createSupabaseRunnerStore()
    const session = await store.getSession(id)
    if (!session || session.user_id !== user.id) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const outcome = await advanceOracleSession(id, {
      store,
      credits: createCreditsPort(),
      // ORACLE_AI_MODE=live|stub. Readings and synthesis follow the flag;
      // verdicts (layer 2) stay on the stub adapter.
      ai: createOracleAiAdapter(),
      ...oracleAiAdvanceOptions(),
      schedule: (task) => after(task),
    })

    return NextResponse.json({
      ok: true,
      sessionId: outcome.sessionId,
      status: outcome.status,
      nextAction: outcome.nextAction,
      progress: outcome.progress,
      claimed: outcome.claimed,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
