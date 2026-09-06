import { listProposals } from '@/lib/reconciliation/proposals-db'
import { fromDal, queryParams, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * AI match proposals, expanded with the deposit + proposed sale rows for
 * display. ?status=pending (default: all, newest first, capped 200).
 */
export async function GET(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const status = queryParams(req).get('status')
  return fromDal(await listProposals(gate.scope, { status }))
}
