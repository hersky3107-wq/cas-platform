import { getPayPalAccessToken, getPayPalApiBase } from '@/lib/payments/paypal'
import type { SubscriptionPlanType } from '@/lib/payments/subscription-plans'

export type PayPalSubscriptionStatus =
  | 'APPROVAL_PENDING'
  | 'APPROVED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'EXPIRED'

export type PayPalSubscription = {
  id: string
  status: PayPalSubscriptionStatus | string
  plan_id?: string
  custom_id?: string
  subscriber?: {
    email_address?: string
    name?: { given_name?: string; surname?: string }
  }
  links?: { href: string; rel: string; method: string }[]
}

type PayPalErrorBody = {
  message?: string
  details?: { issue: string; description: string }[]
}

function formatPayPalError(json: PayPalErrorBody, fallback: string): string {
  const detail = json.details?.map((d) => d.description || d.issue).join('; ')
  return detail || json.message || fallback
}

async function paypalJson<T>(
  path: string,
  init: RequestInit & { method: string }
): Promise<T> {
  const token = await getPayPalAccessToken()
  const res = await fetch(`${getPayPalApiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  const json = (await res.json().catch(() => ({}))) as T & PayPalErrorBody
  if (!res.ok) {
    throw new Error(formatPayPalError(json, `${init.method} ${path} failed (${res.status})`))
  }
  return json as T
}

/** Encode user + plan in custom_id for webhook correlation. */
export function buildSubscriptionCustomId(userId: string, planType: SubscriptionPlanType): string {
  return `${userId}:${planType}`
}

export function parseSubscriptionCustomId(
  customId: string | undefined | null
): { userId: string; planType: SubscriptionPlanType } | null {
  if (!customId) return null
  const idx = customId.indexOf(':')
  if (idx <= 0) return null
  const userId = customId.slice(0, idx)
  const planType = customId.slice(idx + 1)
  if (planType !== 'light' && planType !== 'standard' && planType !== 'pro') return null
  return { userId, planType }
}

export async function createPayPalSubscription(params: {
  planId: string
  userId: string
  planType: SubscriptionPlanType
  subscriberEmail?: string | null
  returnUrl: string
  cancelUrl: string
}): Promise<{ subscriptionId: string; approvalUrl: string; status: string }> {
  const body: Record<string, unknown> = {
    plan_id: params.planId,
    custom_id: buildSubscriptionCustomId(params.userId, params.planType),
    application_context: {
      brand_name: 'AIMANI',
      locale: 'en-US',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'SUBSCRIBE_NOW',
      payment_method: {
        payer_selected: 'PAYPAL',
        payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED',
      },
      return_url: params.returnUrl,
      cancel_url: params.cancelUrl,
    },
  }

  if (params.subscriberEmail) {
    body.subscriber = { email_address: params.subscriberEmail }
  }

  const json = await paypalJson<PayPalSubscription>('/v1/billing/subscriptions', {
    method: 'POST',
    body: JSON.stringify(body),
  })

  const approvalUrl = json.links?.find((l) => l.rel === 'approve')?.href
  if (!approvalUrl) {
    throw new Error('PayPal subscription created but no approval URL returned')
  }

  return {
    subscriptionId: json.id,
    approvalUrl,
    status: json.status,
  }
}

export async function getPayPalSubscription(subscriptionId: string): Promise<PayPalSubscription> {
  return paypalJson<PayPalSubscription>(
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: 'GET' }
  )
}

export async function activatePayPalSubscription(subscriptionId: string): Promise<PayPalSubscription> {
  await paypalJson<unknown>(
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/activate`,
    {
      method: 'POST',
      body: JSON.stringify({ reason: 'Subscriber approved subscription' }),
    }
  )
  return getPayPalSubscription(subscriptionId)
}

export async function verifyPayPalWebhookSignature(params: {
  headers: Headers
  event: unknown
}): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim()
  if (!webhookId) {
    throw new Error('PAYPAL_WEBHOOK_ID is not configured')
  }

  const transmissionId = params.headers.get('paypal-transmission-id')
  const transmissionTime = params.headers.get('paypal-transmission-time')
  const transmissionSig = params.headers.get('paypal-transmission-sig')
  const certUrl = params.headers.get('paypal-cert-url')
  const authAlgo = params.headers.get('paypal-auth-algo')

  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    throw new Error('Missing PayPal webhook signature headers')
  }

  const json = await paypalJson<{ verification_status: string }>(
    '/v1/notifications/verify-webhook-signature',
    {
      method: 'POST',
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: params.event,
      }),
    }
  )

  return json.verification_status === 'SUCCESS'
}
