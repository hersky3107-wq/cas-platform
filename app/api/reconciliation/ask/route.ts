import { askLedger } from '@/lib/reconciliation/ask'
import { fromDal, withOwnedScope } from '@/lib/reconciliation/scope'
import { consumeAnonAi } from '@/lib/reconciliation/anon-workspace'

/**
 * POST /api/reconciliation/ask — AI에게 물어보기 (Part-B ask box).
 *
 * Body: { question: string, month?: 'YYYY-MM' }
 *
 * Answers from a BOUNDED context of the owner's own rows (see
 * lib/reconciliation/ask.ts for the exact caps) with citation refs the UI
 * shows under the answer. Never invents figures: the model is instructed to
 * refuse, and refs it did not receive are dropped server-side.
 *
 * Server-side AI only (financial PII; US/EU-hosted models).
 */
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  const gate = await withOwnedScope(req)
  if (!gate.ok) return gate.response
  const { scope, body } = gate
  const cap = await consumeAnonAi(scope.userId, 'ask')
  if (!cap.ok) return cap.response

  return fromDal(
    await askLedger(scope, {
      question: typeof body.question === 'string' ? body.question : '',
      month: typeof body.month === 'string' ? body.month : null,
    })
  )
}
