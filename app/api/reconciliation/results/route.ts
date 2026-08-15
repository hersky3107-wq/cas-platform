import { createReconciliation, listReconciliations } from '@/lib/reconciliation/db'
import { fromDal, queryParams, withOwnedScope } from '@/lib/reconciliation/scope'

export async function GET(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const q = queryParams(req)
  return fromDal(
    await listReconciliations(gate.scope, {
      status: q.get('status'),
      resolved: q.get('resolved'),
    })
  )
}

export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  return fromDal(await createReconciliation(gate.scope, gate.body), 201)
}
