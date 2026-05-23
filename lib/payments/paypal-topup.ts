import { getSiteUrl } from '@/lib/supabase/site-url'
import { getPayPalAccessToken, getPayPalApiBase } from '@/lib/payments/paypal'
import {
  formatTopUpUsdForPayPal,
  topUpReferenceId,
  TOPUP_PLAN_ID,
} from '@/lib/payments/topup'

type PayPalCreateOrderResponse = {
  id: string
  status: string
  links?: { href: string; rel: string; method: string }[]
}

export function getPayPalOrderApprovalUrl(order: PayPalCreateOrderResponse): string | null {
  const approve = order.links?.find((l) => l.rel === 'approve')
  return approve?.href ?? null
}

export async function createPayPalTopUpOrder(params: {
  amountUsd: number
  userId: string
  origin?: string
}): Promise<{ orderId: string; approvalUrl: string; status: string }> {
  const token = await getPayPalAccessToken()
  const siteUrl = getSiteUrl(params.origin)
  const amount = formatTopUpUsdForPayPal(params.amountUsd)

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
          reference_id: topUpReferenceId(params.amountUsd),
          custom_id: params.userId,
          description: `CAS Platform — instant top-up (${amount} USD)`,
          amount: {
            currency_code: 'USD',
            value: amount,
          },
        },
      ],
      application_context: {
        brand_name: 'CAS Platform',
        user_action: 'PAY_NOW',
        return_url: `${siteUrl}/modes/credits?topup=success&amount=${params.amountUsd}`,
        cancel_url: `${siteUrl}/modes/credits?topup=cancel`,
      },
    }),
  })

  const json = (await res.json().catch(() => ({}))) as PayPalCreateOrderResponse & {
    message?: string
    details?: { issue: string; description: string }[]
  }

  if (!res.ok) {
    const detail = json.details?.map((d) => d.description).join('; ')
    throw new Error(detail || json.message || `PayPal create top-up order failed (${res.status})`)
  }

  const approvalUrl = getPayPalOrderApprovalUrl(json)
  if (!approvalUrl) {
    throw new Error('PayPal did not return an approval URL')
  }

  return { orderId: json.id, approvalUrl, status: json.status }
}

export function parseTopUpCaptureMeta(capture: {
  purchase_units?: {
    reference_id?: string
    custom_id?: string
  }[]
}): { amountUsd: number | null; userId: string | null } {
  const unit = capture.purchase_units?.[0]
  const userId = unit?.custom_id ?? null
  const ref = unit?.reference_id ?? null
  if (!ref?.startsWith(`${TOPUP_PLAN_ID}_`)) {
    return { amountUsd: null, userId }
  }
  const n = Number(ref.slice(TOPUP_PLAN_ID.length + 1))
  const amountUsd = Number.isInteger(n) ? n : null
  return { amountUsd, userId }
}
