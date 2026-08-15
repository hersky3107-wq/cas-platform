import { createChannel, listChannels } from '@/lib/reconciliation/db'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

export async function GET(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  return fromDal(await listChannels(gate.scope))
}

export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  return fromDal(await createChannel(gate.scope, gate.body), 201)
}
