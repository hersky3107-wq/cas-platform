import { NextResponse } from 'next/server'
import { polarClient } from '@/lib/payments/polar'
import { getSiteUrl } from '@/lib/supabase/site-url'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

export async function POST(req: Request) {
  try {
    const missingSb = missingSupabaseEnv()
    if (missingSb) {
      return NextResponse.json({ error: `Server misconfigured: missing ${missingSb}` }, { status: 503 })
    }

    if (!process.env.POLAR_PRODUCT_ID_TOPUP?.trim()) {
      return NextResponse.json(
        { error: 'Server misconfigured: missing POLAR_PRODUCT_ID_TOPUP' },
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

    const amountUSD = typeof body.amountUSD === 'number' ? body.amountUSD : null
    if (!amountUSD || amountUSD < 10) {
      return NextResponse.json({ error: 'amountUSD must be at least 10' }, { status: 400 })
    }

    const origin = req.headers.get('origin') ?? undefined
    const siteUrl = getSiteUrl(origin)

    const checkout = await polarClient.checkouts.create({
      products: [process.env.POLAR_PRODUCT_ID_TOPUP!],
      successUrl: `${siteUrl}/modes/credits?topup=success&amount=${amountUSD}&provider=polar`,
      customerEmail: user.email,
      metadata: { user_id: user.id, amount_usd: amountUSD },
    })

    return NextResponse.json({ checkoutUrl: checkout.url })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[polar/create-topup]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

