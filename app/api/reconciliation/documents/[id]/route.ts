import { deleteDocument, getDocument, updateDocument } from '@/lib/reconciliation/db'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  return fromDal(await getDocument(gate.scope, id))
}

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  return fromDal(await updateDocument(gate.scope, id, gate.body))
}

export async function DELETE(req: Request, ctx: Ctx) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  return fromDal(await deleteDocument(gate.scope, id))
}
