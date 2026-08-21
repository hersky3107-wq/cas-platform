import { NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron/auth'
import { gradeAllDueRounds } from '@/lib/prediction/reconciliation'

/** One sweep can grade many rounds; give it room without being unbounded. */
export const maxDuration = 120

/**
 * POST /api/cron/prediction/reconcile
 *
 * SCHEDULED GRADING IS OFF — DEFERRED, NOT DEAD. This route is intact and
 * authenticated but absent from `vercel.json`, so nothing calls it on a
 * schedule; a request without `?manual=1` deliberately no-ops.
 *
 * Grading is currently triggered two ways instead, both of which cover current
 * round volume without a scheduler: GRADE-ON-READ (a due, ungraded round is
 * claimed and graded when someone opens it — `lib/league/card.ts`) and the admin
 * sweep (`POST /api/admin/prediction/reconcile`). Re-enable the schedule when
 * volume outgrows that — i.e. when rounds routinely go days without a reader and
 * the operator is running the sweep by hand to compensate. Nothing else needs to
 * change at that point: this route already calls the same non-discretionary
 * `gradeAllDueRounds()` pass.
 *
 * Auth: Bearer CRON_SECRET. Public callers get 401.
 *
 * Takes no other input: like every grading entry point, it grades every due,
 * ungraded round and never re-grades a graded one.
 */
export async function POST(req: Request) {
  const authErr = verifyCronAuth(req)
  if (authErr) return authErr

  const url = new URL(req.url)
  if (url.searchParams.get('manual') !== '1') {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'scheduled_league_grading_disabled',
    })
  }

  const report = await gradeAllDueRounds()
  return NextResponse.json({ ok: true, report })
}
