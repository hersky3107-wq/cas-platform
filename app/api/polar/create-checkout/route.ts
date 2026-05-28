import { NextResponse } from 'next/server'
import { polarClient } from '@/lib/payments/polar'
import { getSiteUrl } from '@/lib/supabase/site-url'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'
import { isSubscriptionPlanType, type SubscriptionPlanType } from '@/lib/payments/subscription-plans'

type PolarProduct = {
  id: string
  name: string
}

const PLAN_NAME_HINTS: Record<SubscriptionPlanType, string[]> = {
  light: ['AIMANI Credits Light', 'Light'],
  standard: ['AIMANI Credits Standard', 'Standard'],
  pro: ['AIMANI Credits Pro', 'Pro'],
}

function findProductForPlan(planType: SubscriptionPlanType, products: PolarProduct[]): PolarProduct | null {
  const hints = PLAN_NAME_HINTS[planType]
  const normalized = (s: string) => s.trim().toLowerCase()
  for (const hint of hints) {
    const hit = products.find((p) => normalized(p.name) === normalized(hint))
    if (hit) return hit
  }
  for (const hint of hints) {
    const hit = products.find((p) => normalized(p.name).includes(normalized(hint)))
    if (hit) return hit
  }
  return null
}

export async function POST(req: Request) {
  try {
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

    // Fetch products from Polar and match to the requested plan type.
    // Polar SDK v2 returns a PageIterator here, so we must iterate it.
    const productsIter = await polarClient.products.list({})
    const products: PolarProduct[] = []
    for await (const product of productsIter as AsyncIterable<PolarProduct>) {
      if (product && typeof product.id === 'string' && typeof product.name === 'string') {
        products.push({ id: product.id, name: product.name })
      }
    }
    const product = findProductForPlan(planType, products)
    if (!product) {
      return NextResponse.json(
        { error: `Polar product not found for planType: ${planType}` },
        { status: 500 }
      )
    }

    const checkout = await polarClient.checkouts.create({
      products: [product.id],
      successUrl: `${siteUrl}/modes/credits?checkout_id={CHECKOUT_ID}&planType=${planType}&provider=polar`,
      customerEmail: user.email,
      metadata: {
        user_id: user.id,
        plan_type: planType,
      },
    })

    return NextResponse.json({ checkoutUrl: checkout.url })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[polar/create-checkout]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

