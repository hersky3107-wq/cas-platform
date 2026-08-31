import { NextResponse } from 'next/server'
import { explainDiscrepancy } from '@/lib/reconciliation/explain-discrepancy'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * POST /api/reconciliation/explain-discrepancy
 *
 * Body: { reconciliation_id: uuid, force?: boolean }
 *
 * Asks the models in ADVISORY_MODELS (lib/reconciliation/config.ts) in
 * parallel for an ADVISORY estimate of why a card-type amount_mismatch
 * exists, then cross-verifies: agreement raises confidence, divergence
 * lowers it and shows every model's view side by side.
 * advisory.estimated_cause/confidence/reasoning stay the consensus values
 * (backward compatible); agreement + per_model carry the breakdown.
 * Does not change status (row stays amount_mismatch). Not run during
 * reconcile — explicit user call only (N model calls per request).
 * If an advisory is already stored, it is returned without new AI calls
 * unless force is true.
 */
export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate

  const id = body.reconciliation_id
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'reconciliation_id is required' }, { status: 400 })
  }

  return fromDal(
    await explainDiscrepancy(scope, id, { force: body.force === true })
  )
}
