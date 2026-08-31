import { createChannel, listChannels } from '@/lib/reconciliation/db'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'

/**
 * GET  — list the session user's payment channels.
 * POST — create a channel. Body: { name, channel_type } or { preset } where
 * preset ∈ CHANNEL_PRESETS ids (lib/reconciliation/channel-rules.ts:
 * 'baemin' | 'coupang_eats' | 'alipay' | 'wechat_pay' — all card-type, so
 * they reconcile via the existing reconcile-card path). A preset fills
 * name/channel_type (name overridable) and seeds one reconciliation_rules
 * row with its rough defaults — user-adjustable afterwards like any rule.
 */
export async function GET(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  return fromDal(await listChannels(gate.scope))
}

export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  return fromDal(await createChannel(gate.scope, gate.body), 201)
}
