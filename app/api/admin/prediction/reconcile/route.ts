import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { gradeAllDueRounds } from '@/lib/prediction/reconciliation'

/** One sweep can grade many rounds; give it room without being unbounded. */
export const maxDuration = 120

/**
 * POST /api/admin/prediction/reconcile
 *
 * The operator's grading sweep: grades EVERY due, ungraded round in one pass,
 * with one price-series call per instrument. This is the workflow for rounds
 * generated for blog articles, where grade-on-read alone would wait for a
 * visitor.
 *
 * TAKES NO INPUT, BY DESIGN. No limit, no round id, no category, no force flag,
 * no re-grade. A track record whose operator can pick what gets graded — or
 * grade something twice until it looks better — is not a track record, so
 * anything that looks like a selector is REJECTED with 400 rather than ignored:
 * a caller trying to narrow the sweep must find out, not silently get a full
 * pass they did not ask for. Already-graded rounds are never revisited (see
 * `lib/prediction/grading-core.ts`).
 *
 * Reports per round: graded (direction + the close it was graded against) /
 * unresolvable + reason / rejected + reason.
 *
 * This ONLY touches public.prediction_rounds + public.model_predictions — never
 * Verdict Predict or the generic session tables.
 */
const REJECTED_PARAMS = ['limit', 'round_id', 'roundId', 'instrument', 'category', 'force', 'regrade'] as const

export async function POST(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden

  const { searchParams } = new URL(req.url)
  const offending = REJECTED_PARAMS.filter((param) => searchParams.has(param))
  if (offending.length > 0) {
    return NextResponse.json(
      {
        error: 'grading_is_not_selectable',
        detail:
          `Grading takes no parameters (got: ${offending.join(', ')}). Every due, ungraded round is graded, ` +
          'and a graded round is never re-graded.',
      },
      { status: 400 }
    )
  }

  const report = await gradeAllDueRounds()
  return NextResponse.json({ ok: true, report })
}
