import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { reconcileDuePredictionRounds } from '@/lib/prediction/reconciliation'

/** Reconciliation can scan many due rounds; give it room without being unbounded. */
export const maxDuration = 120

/**
 * Admin/service-role-only trigger for the AI Prediction League reconciliation
 * pass. This is the supported manual path; automatic reconciliation is
 * intentionally unscheduled.
 *
 * This ONLY touches public.prediction_rounds + public.model_predictions — never
 * Verdict Predict or the generic session tables.
 *
 * POST /api/admin/prediction/reconcile        -> reconcile up to 200 due rounds
 * POST /api/admin/prediction/reconcile?limit=N -> cap the batch size
 */
export async function POST(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden

  const url = new URL(req.url)
  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 1000) : 200

  const summary = await reconcileDuePredictionRounds(limit)
  return NextResponse.json({ ok: true, summary })
}
