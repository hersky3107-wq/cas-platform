/**
 * GET /api/oracle/session/[id] — poll.
 *
 * Read-only and idempotent. Safe to call every 2 seconds, and reading a
 * finished session costs ZERO credits: this route never touches the credits
 * module at all.
 */
import { NextResponse } from 'next/server'
import { readOracleSession } from '@/lib/oracle/runner'
import { createSupabaseRunnerStore } from '@/lib/oracle/runner/store'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    const store = createSupabaseRunnerStore()
    const session = await store.getSession(id)
    // A session owned by someone else is reported as missing, not forbidden.
    if (!session || session.user_id !== user.id) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, ...(await readOracleSession(session, store)) })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
