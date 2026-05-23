import { NextResponse } from 'next/server'
import { missingPayPalServerEnv } from '@/lib/payments/paypal'
import { createPayPalSubscription } from '@/lib/payments/paypal-subscriptions'
import {
  getPayPalPlanId,
  isSubscriptionPlanType,
  missingSubscriptionPlanEnv,
} from '@/lib/payments/subscription-plans'
import { getSiteUrl } from '@/lib/supabase/site-url'
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

    const planType = body.planType
    if (!isSubscriptionPlanType(planType)) {
      return NextResponse.json(
        { error: 'planType must be light, standard, or pro' },
        { status: 400 }
      )
    }

    const missingPlan = missingSubscriptionPlanEnv(planType)
    if (missingPlan) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missingPlan}` },
        { status: 503 }
      )
    }

    const paypalPlanId = getPayPalPlanId(planType)!
    const origin = req.headers.get('origin') ?? undefined
    const siteUrl = getSiteUrl(origin)

    const { approvalUrl, subscriptionId, status } = await createPayPalSubscription({
      planId: paypalPlanId,
      userId: user.id,
      planType,
      subscriberEmail: user.email ?? null,
      returnUrl: `${siteUrl}/modes/credits?subscription=success&planType=${planType}`,
      cancelUrl: `${siteUrl}/modes/credits?subscription=cancel`,
    })

    return NextResponse.json({
      approvalUrl,
      subscriptionId,
      status,
      planType,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[paypal/create-subscription]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
