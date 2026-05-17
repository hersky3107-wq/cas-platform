import { NextResponse } from 'next/server'
import { getCreditPlan, isCreditPlanId } from '@/lib/payments/credit-plans'
import { createPayPalOrder, missingPayPalServerEnv } from '@/lib/payments/paypal'
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

    const planId = body.planId
    if (!isCreditPlanId(planId)) {
      return NextResponse.json(
        { error: 'planId must be starter, popular, or pro' },
        { status: 400 }
      )
    }

    const plan = getCreditPlan(planId)!
    const origin = req.headers.get('origin') ?? undefined

    const { orderId, status } = await createPayPalOrder({
      plan,
      userId: user.id,
      origin,
    })

    return NextResponse.json({
      orderId,
      status,
      planId: plan.id,
      credits: plan.credits,
      amount: plan.priceUsd,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[paypal/create-order]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
