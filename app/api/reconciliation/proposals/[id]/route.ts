import { NextResponse } from 'next/server'
import { approveProposal, getProposal, rejectProposal } from '@/lib/reconciliation/proposals-db'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  return fromDal(await getProposal(gate.scope, id))
}

/**
 * THE OWNER DECIDES an AI match proposal — the only path from proposal to
 * reconciliation (AI never auto-commits).
 *
 * Body:
 *   { action: 'approve', sale_ids?: uuid[], note?: string }
 *       sale_ids edits the AI's set before approving (stored as a
 *       correction the next inference round learns from). Verdict is
 *       recomputed with the authoritative issuer FRACTION rate:
 *       within tolerance → matched, beyond → amount_mismatch. The
 *       reconciliation row carries source='ai_confirmed'.
 *   { action: 'reject', note?: string, corrected_issuer_id?: uuid }
 *       corrected_issuer_id also fixes the deposit's issuer
 *       (issuer_source='user') and appends a memo alias (learning).
 */
export async function POST(req: Request, ctx: Ctx) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate
  const { id } = await ctx.params

  const action = typeof body.action === 'string' ? body.action : ''
  if (action === 'approve') {
    const saleIds = Array.isArray(body.sale_ids)
      ? body.sale_ids.filter((v): v is string => typeof v === 'string')
      : undefined
    return fromDal(
      await approveProposal(scope, id, {
        saleIds,
        note: typeof body.note === 'string' ? body.note : null,
      }),
      201
    )
  }
  if (action === 'reject') {
    return fromDal(
      await rejectProposal(scope, id, {
        note: typeof body.note === 'string' ? body.note : null,
        correctedIssuerId:
          typeof body.corrected_issuer_id === 'string' ? body.corrected_issuer_id : null,
      })
    )
  }
  return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 })
}
