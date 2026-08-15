import { createSale, listSales } from '@/lib/reconciliation/db'
import { fromDal, queryParams, withOwnedScope } from '@/lib/reconciliation/scope'

export async function GET(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const q = queryParams(req)
  return fromDal(
    await listSales(gate.scope, {
      from: q.get('from'),
      to: q.get('to'),
      confirm_status: q.get('confirm_status'),
      channel_id: q.get('channel_id'),
    })
  )
}

export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  return fromDal(await createSale(gate.scope, gate.body), 201)
}
