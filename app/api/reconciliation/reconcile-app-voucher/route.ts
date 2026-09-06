import { runUnifiedReconcile } from '@/lib/reconciliation/reconcile'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * LEGACY ALIAS (kept so the pre-redesign UI keeps working until Part B).
 * See reconcile-card/route.ts — one unified idempotent engine, aliased.
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
