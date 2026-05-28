import { NextResponse } from 'next/server'
import { polarClient } from '@/lib/payments/polar'
import { getSiteUrl } from '@/lib/supabase/site-url'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'
import { isSubscriptionPlanType, type SubscriptionPlanType } from '@/lib/payments/subscription-plans'

export async function POST(req: Request) {
  try {
    console.log('[polar/env]', {
      LIGHT: process.env.POLAR_PRODUCT_ID_LIGHT,
      STANDARD: process.env.POLAR_PRODUCT_ID_STANDARD,
      PRO: process.env.POLAR_PRODUCT_ID_PRO,
    })

    const missingSb = missingSupabaseEnv()
    if (missingSb) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missingSb}` },
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

    const planTypeRaw = body.planType
    if (!isSubscriptionPlanType(planTypeRaw)) {
      return NextResponse.json(
        { error: 'planType must be light, standard, or pro' },
        { status: 400 }
      )
    }
    const planType = planTypeRaw satisfies SubscriptionPlanType

    const origin = req.headers.get('origin') ?? undefined
    const siteUrl = getSiteUrl(origin)

    const productIds = {
      light: process.env['POLAR_PRODUCT_ID_LIGHT'] ?? '',
      standard: process.env['POLAR_PRODUCT_ID_STANDARD'] ?? '',
      pro: process.env['POLAR_PRODUCT_ID_PRO'] ?? '',
    }

    const productId = productIds[planType]
    if (!productId) {
      return NextResponse.json(
        { error: `Missing product ID for plan: ${planType}` },
        { status: 500 }
      )
    }

    const checkout = await polarClient.checkouts.create({
      products: [productId],
      successUrl: `${siteUrl}/modes/credits?checkout_id={CHECKOUT_ID}&planType=${planType}&provider=polar`,
      customerEmail: user.email,
      metadata: { user_id: user.id, plan_type: planType },
    })

    return NextResponse.json({ checkoutUrl: checkout.url })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[polar/create-checkout]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

