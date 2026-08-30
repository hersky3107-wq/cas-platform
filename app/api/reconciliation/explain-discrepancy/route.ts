import { NextResponse } from 'next/server'
import { explainDiscrepancy } from '@/lib/reconciliation/explain-discrepancy'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * POST /api/reconciliation/explain-discrepancy
 *
 * Body: { reconciliation_id: uuid, force?: boolean }
 *
 * Asks a single AI for an ADVISORY estimate of why a card-type
 * amount_mismatch exists. Does not change status (row stays
 * amount_mismatch). Not run during reconcile — explicit call only.
 * If an advisory is already stored, it is returned without a new AI
 * call unless force is true.
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
