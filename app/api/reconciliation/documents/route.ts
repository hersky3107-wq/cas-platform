import { fromDal, queryParams, withOwnedScope } from '@/lib/reconciliation/scope'
import { createDocument, listDocuments } from '@/lib/reconciliation/db'

export async function GET(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const q = queryParams(req)
  return fromDal(await listDocuments(gate.scope, { parse_status: q.get('parse_status') }))
}

export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  return fromDal(await createDocument(gate.scope, gate.body), 201)
}
