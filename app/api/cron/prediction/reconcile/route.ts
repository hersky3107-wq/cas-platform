import { NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron/auth'
import { reconcileDuePredictionRounds } from '@/lib/prediction/reconciliation'

/** Reconciliation can scan many due rounds; give it room without being unbounded. */
export const maxDuration = 120

/**
 * POST /api/cron/prediction/reconcile
 *
 * Legacy cron-secret reconciliation pass. It is NOT scheduled in
 * `vercel.json`. Requests without `?manual=1` safely no-op. Normal manual
 * operation should use the admin-only
 * `POST /api/admin/prediction/reconcile` endpoint instead.
 *
 * With `?manual=1`, this retained operational fallback selects due, unresolved
 * rounds, resolves outcomes, and grades child predictions. It reuses the
 * existing `reconcileDuePredictionRounds` engine.
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
  if (url.searchParams.get('manual') !== '1') {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'automatic_league_reconciliation_disabled',
    })
  }

  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 1000) : 200

  const summary = await reconcileDuePredictionRounds(limit)
  return NextResponse.json({ ok: true, summary })
}
