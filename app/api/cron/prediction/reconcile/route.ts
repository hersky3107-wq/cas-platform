import { NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron/auth'
import { reconcileDuePredictionRounds } from '@/lib/prediction/reconciliation'

/** Reconciliation can scan many due rounds; give it room without being unbounded. */
export const maxDuration = 120

/**
 * POST /api/cron/prediction/reconcile
 *
 * Vercel-cron-triggered reconciliation pass. Selects due, unresolved rounds in
 * the confirmed-source categories, resolves their actual outcome via Twelve
 * Data (the same source the orchestrator used for the data packet), and grades
 * each child model_prediction's is_correct. Reuses the existing
 * `reconcileDuePredictionRounds` — this route only adds cron auth + HTTP.
 *
 * Auth: Bearer CRON_SECRET. Public callers get 401.
 *
 * Query params:
 *   ?limit=N   — cap the batch size (default 200, max 1000)
 */
export async function POST(req: Request) {
  const authErr = verifyCronAuth(req)
  if (authErr) return authErr

  const url = new URL(req.url)
  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 1000) : 200

  const summary = await reconcileDuePredictionRounds(limit)
  return NextResponse.json({ ok: true, summary })
}
