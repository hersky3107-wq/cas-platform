import { reconcileAppVouchers } from '@/lib/reconciliation/reconcile'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * Run the APP-VOUCHER reconciliation pass (탐나는전 앱, 온누리 앱) over the
 * session user's open sales_records vs deposit_records.
 *
 * Body (all optional): { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', channel_id?: uuid }
 *
 * STAGE 2 sibling of POST /api/reconciliation/reconcile: SAME matcher
 * (planTransferReconciliations, unchanged) scoped to
 * payment_channels.channel_type = 'app_voucher' instead of 'transfer'. Goes
 * through withOwnedScope; every query inside reconcileAppVouchers is
 * filtered to user_id = session uid.
 */
export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate

  return fromDal(
    await reconcileAppVouchers(scope, {
      from: typeof body.from === 'string' ? body.from : null,
      to: typeof body.to === 'string' ? body.to : null,
      channelId: typeof body.channel_id === 'string' ? body.channel_id : null,
    }),
    201
  )
}
