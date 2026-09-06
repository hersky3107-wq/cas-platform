import { runUnifiedReconcile } from '@/lib/reconciliation/reconcile'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * LEGACY ALIAS (kept so the pre-redesign UI keeps working until Part B).
 *
 * The per-channel-type passes are gone: card matching is per ISSUER now and
 * one unified engine covers every reconciled method. This alias simply runs
 * that engine — because the engine is idempotent, calling /reconcile,
 * /reconcile-card and /reconcile-app-voucher in sequence (as the old UI
 * does) performs the work once and no-ops afterwards.
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
