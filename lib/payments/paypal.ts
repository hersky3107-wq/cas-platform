import { getSiteUrl } from '@/lib/supabase/site-url'
import type { CreditPlan } from '@/lib/payments/credit-plans'

type PayPalTokenResponse = { access_token: string; expires_in: number }

type PayPalCreateOrderResponse = {
  id: string
  status: string
  links?: { href: string; rel: string; method: string }[]
}

type PayPalCaptureResponse = {
  id: string
  status: string
  purchase_units?: {
    reference_id?: string
    custom_id?: string
    payments?: {
      captures?: { id: string; status: string; amount?: { value: string } }[]
    }
  }[]
}

let cachedToken: { token: string; expiresAt: number } | null = null

export function getPayPalApiBase(): string {
  const explicit = process.env.PAYPAL_API_BASE?.trim()
  if (explicit) return explicit.replace(/\/$/, '')

  const env = process.env.PAYPAL_ENV?.trim().toLowerCase()
  if (env === 'sandbox') return 'https://api-m.sandbox.paypal.com'
  if (env === 'live' || env === 'production') return 'https://api.paypal.com'

  return process.env.NODE_ENV === 'production'
    ? 'https://api.paypal.com'
    : 'https://api-m.sandbox.paypal.com'
}

export function getPayPalClientId(): string | null {
  return (
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID?.trim() ||
    process.env.PAYPAL_CLIENT_ID?.trim() ||
    null
  )
}

function getPayPalCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim()
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function missingPayPalServerEnv(): string | null {
  if (!getPayPalCredentials()) {
    if (!process.env.PAYPAL_CLIENT_ID?.trim()) return 'PAYPAL_CLIENT_ID'
    return 'PAYPAL_CLIENT_SECRET'
  }
  return null
}

export async function getPayPalAccessToken(): Promise<string> {
  const creds = getPayPalCredentials()
  if (!creds) {
    throw new Error('PayPal credentials are not configured')
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token
  }

  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')
  const res = await fetch(`${getPayPalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  const json = (await res.json().catch(() => ({}))) as PayPalTokenResponse & {
    error?: string
    error_description?: string
  }

  if (!res.ok) {
    throw new Error(json.error_description || json.error || `PayPal auth failed (${res.status})`)
  }

  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 300) * 1000,
  }

  return json.access_token
}

export async function createPayPalOrder(params: {
  plan: CreditPlan
  userId: string
  origin?: string
}): Promise<{ orderId: string; status: string }> {
  const token = await getPayPalAccessToken()
  const siteUrl = getSiteUrl(params.origin)

  const res = await fetch(`${getPayPalApiBase()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: params.plan.id,
          custom_id: params.userId,
          description: `AIMANI — ${params.plan.description}`,
          amount: {
            currency_code: 'USD',
            value: params.plan.priceUsd,
          },
        },
      ],
      application_context: {
        brand_name: 'AIMANI',
        user_action: 'PAY_NOW',
        return_url: `${siteUrl}/modes/credits?status=success`,
        cancel_url: `${siteUrl}/modes/credits?status=cancelled`,
      },
    }),
  })

  const json = (await res.json().catch(() => ({}))) as PayPalCreateOrderResponse & {
    message?: string
    details?: { issue: string; description: string }[]
  }

  if (!res.ok) {
    const detail = json.details?.map((d) => d.description).join('; ')
    throw new Error(detail || json.message || `PayPal create order failed (${res.status})`)
  }

  return { orderId: json.id, status: json.status }
}

export async function capturePayPalOrder(orderId: string): Promise<PayPalCaptureResponse> {
  const token = await getPayPalAccessToken()

  const res = await fetch(`${getPayPalApiBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  const json = (await res.json().catch(() => ({}))) as PayPalCaptureResponse & {
    message?: string
    details?: { issue: string; description: string }[]
  }

  if (!res.ok) {
    const detail = json.details?.map((d) => d.description).join('; ')
    throw new Error(detail || json.message || `PayPal capture failed (${res.status})`)
  }

  return json
}

export function parseCapturedPlanFromOrder(
  capture: PayPalCaptureResponse
): { planId: string | null; userId: string | null } {
  const unit = capture.purchase_units?.[0]
  return {
    planId: unit?.reference_id ?? null,
    userId: unit?.custom_id ?? null,
  }
}
