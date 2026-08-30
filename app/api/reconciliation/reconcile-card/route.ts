import { reconcileCards } from '@/lib/reconciliation/reconcile'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * Run the CARD-TYPE reconciliation pass (channel_type='card': card, 바코드결제,
 * 알리페이/위챗, 텍스프리, 배달앱) over the session user's open sales vs deposits.
 *
 * Body (all optional): { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', channel_id?: uuid }
 *
 * Same matcher as POST /api/reconciliation/reconcile (planTransferReconciliations)
 * scoped to payment_channels.channel_type = 'card'. Deposits must carry a
 * channel_hint on a card channel (manual entry for now). Goes through
 * withOwnedScope; every query inside reconcileCards is filtered to
 * user_id = session uid.
 */
export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate

  return fromDal(
    await reconcileCards(scope, {
      from: typeof body.from === 'string' ? body.from : null,
      to: typeof body.to === 'string' ? body.to : null,
      channelId: typeof body.channel_id === 'string' ? body.channel_id : null,
    }),
    201
  )
}
