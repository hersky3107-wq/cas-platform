import { runUnifiedReconcile } from '@/lib/reconciliation/reconcile'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * UNIFIED deterministic reconciliation run (Step-2 engine).
 *
 * ONE pass over every RECONCILED method: card per issuer (window matching,
 * fraction fees, refund netting) + app_voucher / barcode_pay / delivery_app /
 * foreign_pay / tax_free per channel. Settlement-only methods (cash /
 * transfer / paper_voucher) are 정산 전용 and never touched — the transfer
 * reconciler is retired; this route no longer creates transfer rows.
 *
 * Deterministic only: exact/batch matches, window-expired missing_deposit,
 * aged candidate-free unmatched_deposit. Whatever it cannot resolve stays
 * open and is counted in summary.deposits_left_open — feed those to
 * POST /api/reconciliation/infer-matches for AI proposals.
 *
 * Body (all optional): { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', channel_id?: uuid }
 * Idempotent: matched rows are never consumed twice; re-runs create nothing new.
 */
export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate

  return fromDal(
    await runUnifiedReconcile(scope, {
      from: typeof body.from === 'string' ? body.from : null,
      to: typeof body.to === 'string' ? body.to : null,
      channelId: typeof body.channel_id === 'string' ? body.channel_id : null,
    }),
    201
  )
}
