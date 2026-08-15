import { createRule, listRules } from '@/lib/reconciliation/db'
import { fromDal, queryParams, withOwnedScope } from '@/lib/reconciliation/scope'

export async function GET(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const q = queryParams(req)
  return fromDal(await listRules(gate.scope, { channel_id: q.get('channel_id') }))
}

export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  return fromDal(await createRule(gate.scope, gate.body), 201)
}
