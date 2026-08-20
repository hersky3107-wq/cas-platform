/**
 * GET /api/cron/oracle-sweep — every minute (see vercel.json).
 *
 * Finds sessions whose worker died — non-terminal, heartbeat older than
 * ORACLE_STALE_HEARTBEAT_SECONDS, lease free or expired — and advances each
 * by one chunk, capped at ORACLE_SWEEP_BATCH_SIZE per run. This is what makes
 * a session survive a phone that locked mid-reading.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`, which Vercel Cron sends
 * automatically. Public callers get 401.
 */
import { after, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron/auth'
import { createOracleAiAdapter, oracleAiAdvanceOptions } from '@/lib/oracle/ai/create-adapter'
import { ORACLE_SWEEP_BATCH_SIZE, sweepOracleSessions } from '@/lib/oracle/runner'
import { createCreditsPort } from '@/lib/oracle/runner/credits'
import { createSupabaseRunnerStore } from '@/lib/oracle/runner/store'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: Request) {
  const authErr = verifyCronAuth(req)
  if (authErr) return authErr

  try {
    const url = new URL(req.url)
    const limitParam = Number(url.searchParams.get('limit'))
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, ORACLE_SWEEP_BATCH_SIZE)
        : ORACLE_SWEEP_BATCH_SIZE

    const summary = await sweepOracleSessions(
      {
        store: createSupabaseRunnerStore(),
        credits: createCreditsPort(),
        ai: createOracleAiAdapter(),
        ...oracleAiAdvanceOptions(),
        schedule: (task) => after(task),
      },
      limit,
    )

    return NextResponse.json({ ok: true, summary })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
