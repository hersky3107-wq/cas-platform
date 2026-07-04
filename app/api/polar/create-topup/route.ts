import { NextResponse } from 'next/server'
import { getPolarClient } from '@/lib/payments/polar'
import { getSiteUrl } from '@/lib/supabase/site-url'
import { creditsForTopUpUsd, isValidTopUpAmountUsd } from '@/lib/payments/topup'
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

    const amountUSD = body.amountUSD
    if (!isValidTopUpAmountUsd(amountUSD)) {
      return NextResponse.json(
        { error: 'amountUSD must be $8 or a $10 increment from $10 to $300' },
        { status: 400 }
      )
    }

    const topupCredits = creditsForTopUpUsd(amountUSD)

    const origin = req.headers.get('origin') ?? undefined
    const siteUrl = getSiteUrl(origin)

    const polar = getPolarClient()

    const checkout = await polar.checkouts.create({
      products: [process.env.POLAR_PRODUCT_ID_TOPUP!],
      successUrl: `${siteUrl}/modes/credits?topup=success&amount=${amountUSD}&provider=polar`,
      customerEmail: user.email,
      metadata: { user_id: user.id, amount_usd: amountUSD, topup_credits: topupCredits },
    })

    return NextResponse.json({ checkoutUrl: checkout.url })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[polar/create-topup]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

