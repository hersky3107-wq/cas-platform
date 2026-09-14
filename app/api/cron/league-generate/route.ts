/**
 * GET /api/cron/league-generate — every minute (see vercel.json).
 *
 * Claims queued league generation jobs and jobs whose worker died —
 * heartbeat older than LEAGUE_JOB_STALE_HEARTBEAT_SECONDS, lease free or
 * expired — and advances each, capped at LEAGUE_JOB_MAX_RUNNING jobs being
 * worked globally. The lease claim inside advance makes this safe to run
 * concurrently with the inline generate route's own first advance and with
 * overlapping cron invocations.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`, exactly the oracle-sweep
 * pattern (constant-time compare in lib/cron/auth.ts). Public callers get 401.
 */
import { after, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron/auth'
import { createDeepRunnerDeps } from '@/lib/league/generation/deep-live-deps'
import { createLeagueRunnerDeps } from '@/lib/league/generation/live-deps'
import { LEAGUE_JOB_SWEEP_BATCH_SIZE } from '@/lib/league/generation/policy'
import { sweepLeagueDeepRuns } from '@/lib/league/generation/deep-runner'
import { sweepLeagueGenerationJobs } from '@/lib/league/generation/runner'

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
        ? Math.min(limitParam, LEAGUE_JOB_SWEEP_BATCH_SIZE)
        : LEAGUE_JOB_SWEEP_BATCH_SIZE

    const schedule = (task: () => Promise<void>) => after(task)
    const generation = await sweepLeagueGenerationJobs(createLeagueRunnerDeps(schedule), limit)
    const deep = await sweepLeagueDeepRuns(createDeepRunnerDeps(schedule), limit)

    return NextResponse.json({ ok: true, summary: { generation, deep } })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
