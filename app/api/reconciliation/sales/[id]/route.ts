import { deleteSale, getSale, updateSale } from '@/lib/reconciliation/db'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  return fromDal(await getSale(gate.scope, id))
}

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  return fromDal(await updateSale(gate.scope, id, gate.body))
}

export async function DELETE(req: Request, ctx: Ctx) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  return fromDal(await deleteSale(gate.scope, id))
}
