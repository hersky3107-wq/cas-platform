import { inferMatchProposals } from '@/lib/reconciliation/match-infer'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * AI MATCH INFERENCE — run AFTER the deterministic engine
 * (POST /api/reconciliation/reconcile). For each unmatched deposit it builds
 * a bounded candidate set deterministically, asks the ADVISORY_MODELS roster
 * independently which sale combination the deposit represents, cross-checks
 * the answers, and writes PROPOSALS (never reconciliations — the owner
 * confirms via POST /api/reconciliation/proposals/[id]).
 *
 * Body (optional): { deposit_ids?: uuid[] }  — otherwise the newest unmatched
 * deposits are picked, capped at INFER_MAX_DEPOSITS_PER_RUN per call.
 *
 * All model calls are server-side (financial PII; US/EU-hosted models only).
 */
export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate

  const depositIds = Array.isArray(body.deposit_ids)
    ? body.deposit_ids.filter((v): v is string => typeof v === 'string')
    : undefined

  return fromDal(await inferMatchProposals(scope, { depositIds }), 201)
}
