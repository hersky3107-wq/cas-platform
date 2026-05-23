import { NextResponse } from 'next/server'
import { createPayPalTopUpOrder } from '@/lib/payments/paypal-topup'
import { missingPayPalServerEnv } from '@/lib/payments/paypal'
import { isValidTopUpAmountUsd } from '@/lib/payments/topup'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

export async function POST(req: Request) {
  try {
    const missingSb = missingSupabaseEnv()
    if (missingSb) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missingSb}` },
        { status: 503 }
      )
    }

    const missingPayPal = missingPayPalServerEnv()
    if (missingPayPal) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missingPayPal}` },
        { status: 503 }
      )
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { user, error: authErr } = await resolveRouteAuth(req, body)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const amountUSD = body.amountUSD
    if (!isValidTopUpAmountUsd(amountUSD)) {
      return NextResponse.json(
        {
          error: `amountUSD must be an integer from 10 to 300 in steps of 10`,
        },
        { status: 400 }
      )
    }

    const origin = req.headers.get('origin') ?? undefined
    const { approvalUrl, orderId, status } = await createPayPalTopUpOrder({
      amountUsd: amountUSD,
      userId: user.id,
      origin,
    })

    return NextResponse.json({ approvalUrl, orderId, status })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[paypal/create-topup]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
