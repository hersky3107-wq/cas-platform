import { resolveDepositIssuers } from '@/lib/reconciliation/memo-resolve'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * MEMO → ISSUER resolution for unresolved deposits.
 *
 * Deterministic memo_aliases pass first (free; source='parser'), then ONE
 * batched multi-model prompt for the rest (source='ai'; majority vote,
 * disagreement surfaced as unresolved with each model's view). Rows the
 * owner fixed by hand (issuer_source='user') are never touched. Corrections
 * go through PATCH /api/reconciliation/deposits/[id] with
 * { issuer_id, issuer_source: 'user' } — which also learns the memo alias.
 *
 * Body (optional): { deposit_ids?: uuid[], use_ai?: boolean }
 */
export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate

  const depositIds = Array.isArray(body.deposit_ids)
    ? body.deposit_ids.filter((v): v is string => typeof v === 'string')
    : undefined

  return fromDal(
    await resolveDepositIssuers(scope, {
      depositIds,
      useAi: body.use_ai !== false,
    })
  )
}
