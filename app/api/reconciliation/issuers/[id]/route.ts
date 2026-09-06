import { deleteIssuer, getIssuer, updateIssuer } from '@/lib/reconciliation/issuers-db'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

type Ctx = { params: Promise<{ id: string }> }

/**
 * One card issuer. PATCH edits fee_rate (FRACTION 0.0015 = 0.15%),
 * settlement_days, settlement_window_days, memo_aliases, is_active.
 * DELETE refuses (409) while sales/deposits/reconciliations reference the
 * issuer — deactivate instead.
 */
export async function GET(req: Request, ctx: Ctx) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  return fromDal(await getIssuer(gate.scope, id))
}

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  return fromDal(await updateIssuer(gate.scope, id, gate.body))
}

export async function DELETE(req: Request, ctx: Ctx) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  return fromDal(await deleteIssuer(gate.scope, id))
}
