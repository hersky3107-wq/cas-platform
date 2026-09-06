import { createIssuer, listIssuers } from '@/lib/reconciliation/issuers-db'
import { fromDal, queryParams, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * Card issuer master (card_issuers).
 *
 * GET  → the user's issuers, ordered. First touch seeds the 11 common Korean
 *        issuers with EDITABLE ESTIMATE defaults (fee_rate 0.0015 = 0.15%
 *        FRACTION, T+2, window 3) — correct them from real statements.
 *        ?include_inactive=true to list retired issuers too.
 * POST → add a custom issuer. fee_rate is a FRACTION (0.0015), never percent.
 */
export async function GET(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const includeInactive = queryParams(req).get('include_inactive') === 'true'
  return fromDal(await listIssuers(gate.scope, { includeInactive }))
}

export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  return fromDal(await createIssuer(gate.scope, gate.body), 201)
}
