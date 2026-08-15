import { reconcileTransfers } from '@/lib/reconciliation/reconcile'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * Run the transfer reconciliation pass over the session user's open
 * sales_records vs deposit_records.
 *
 * Body (all optional): { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', channel_id?: uuid }
 *
 * STAGE 1: bank-transfer channels only. Goes through withOwnedScope; every
 * query inside reconcileTransfers is filtered to user_id = session uid.
 */
export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate

  return fromDal(
    await reconcileTransfers(scope, {
      from: typeof body.from === 'string' ? body.from : null,
      to: typeof body.to === 'string' ? body.to : null,
      channelId: typeof body.channel_id === 'string' ? body.channel_id : null,
    }),
    201
  )
}
