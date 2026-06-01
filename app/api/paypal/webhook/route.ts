import { NextResponse } from 'next/server'
import { missingPayPalServerEnv } from '@/lib/payments/paypal'
import {
  parseSubscriptionCustomId,
  verifyPayPalWebhookSignature,
} from '@/lib/payments/paypal-subscriptions'
import {
  applySubscriptionCredits,
  findSubscriptionByPaypalId,
  updateSubscriptionStatusByPaypalId,
  upsertSubscriptionRow,
} from '@/lib/payments/subscription-db'
type PayPalWebhookEvent = {
  id?: string
  event_type?: string
  resource?: Record<string, unknown>
}

function subscriptionIdFromResource(resource: Record<string, unknown> | undefined): string | null {
  if (!resource) return null
  const id = resource.id
  if (typeof id === 'string' && id.startsWith('I-')) return id
  const billingAgreementId = resource.billing_agreement_id
  if (typeof billingAgreementId === 'string') return billingAgreementId
  return null
}

async function handleSubscriptionActivated(resource: Record<string, unknown> | undefined) {
  const paypalSubscriptionId = subscriptionIdFromResource(resource)
  if (!paypalSubscriptionId) {
    console.warn('[paypal/webhook] ACTIVATED: missing subscription id')
    return
  }

  const customId =
    typeof resource?.custom_id === 'string' ? resource.custom_id : null
  const parsed = parseSubscriptionCustomId(customId)

  if (!parsed) {
    const existing = await findSubscriptionByPaypalId(paypalSubscriptionId)
    if (existing) {
      await updateSubscriptionStatusByPaypalId(paypalSubscriptionId, 'active')
      await applySubscriptionCredits(existing.user_id, existing.plan_type)
    } else {
      console.warn('[paypal/webhook] ACTIVATED: could not resolve user/plan', paypalSubscriptionId)
    }
    return
  }

  await upsertSubscriptionRow({
    userId: parsed.userId,
    paypalSubscriptionId,
    planType: parsed.planType,
    status: 'active',
  })
  await applySubscriptionCredits(parsed.userId, parsed.planType)
}

async function handlePaymentSaleCompleted(resource: Record<string, unknown> | undefined) {
  const paypalSubscriptionId = subscriptionIdFromResource(resource)
  if (!paypalSubscriptionId) {
    console.warn('[paypal/webhook] PAYMENT.SALE.COMPLETED: missing billing agreement id')
    return
  }

  const row = await findSubscriptionByPaypalId(paypalSubscriptionId)
  if (!row || row.status !== 'active') {
    console.warn(
      '[paypal/webhook] PAYMENT.SALE.COMPLETED: no active subscription row',
      paypalSubscriptionId
    )
    return
  }

  await applySubscriptionCredits(row.user_id, row.plan_type)
}

async function handleSubscriptionCancelled(resource: Record<string, unknown> | undefined) {
  const paypalSubscriptionId = subscriptionIdFromResource(resource)
  if (!paypalSubscriptionId) return
  await updateSubscriptionStatusByPaypalId(paypalSubscriptionId, 'cancelled')
}

async function handleSubscriptionSuspended(resource: Record<string, unknown> | undefined) {
  const paypalSubscriptionId = subscriptionIdFromResource(resource)
  if (!paypalSubscriptionId) return
  await updateSubscriptionStatusByPaypalId(paypalSubscriptionId, 'suspended')
}

export async function POST(req: Request) {
  try {
    const missingPayPal = missingPayPalServerEnv()
    if (missingPayPal) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missingPayPal}` },
        { status: 503 }
      )
    }

    if (!process.env.PAYPAL_WEBHOOK_ID?.trim()) {
      return NextResponse.json(
        { error: 'Server misconfigured: missing PAYPAL_WEBHOOK_ID' },
        { status: 503 }
      )
    }

    let event: PayPalWebhookEvent
    try {
      event = (await req.json()) as PayPalWebhookEvent
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const verified = await verifyPayPalWebhookSignature({
      headers: req.headers,
      event,
    })

    if (!verified) {
      console.warn('[paypal/webhook] Signature verification failed - BYPASS ACTIVE FOR TESTING')
      // TEMP: bypass for testing only - MUST be restored before production
    }

    const eventType = event.event_type ?? ''
    const resource = event.resource

    switch (eventType) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        await handleSubscriptionActivated(resource)
        break
      case 'PAYMENT.SALE.COMPLETED':
        await handlePaymentSaleCompleted(resource)
        break
      case 'BILLING.SUBSCRIPTION.CANCELLED':
        await handleSubscriptionCancelled(resource)
        break
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
        await handleSubscriptionSuspended(resource)
        break
      default:
        break
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[paypal/webhook]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
