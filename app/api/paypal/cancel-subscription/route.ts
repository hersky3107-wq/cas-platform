import { NextResponse } from 'next/server'
import { missingPayPalServerEnv } from '@/lib/payments/paypal'
import { cancelPayPalSubscription } from '@/lib/payments/paypal-subscriptions'
import {
  getSubscriptionForUser,
  updateSubscriptionStatusByPaypalId,
} from '@/lib/payments/subscription-db'
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

    let body: Record<string, unknown> = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }

    const { user, error: authErr } = await resolveRouteAuth(req, body)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const row = await getSubscriptionForUser(user.id)
    if (!row || row.status !== 'active') {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 })
    }

    const creditsValidUntil = row.current_period_end ?? null

    await cancelPayPalSubscription(row.paypal_subscription_id)

    const updated = await updateSubscriptionStatusByPaypalId(
      row.paypal_subscription_id,
      'cancelled'
    )

    if (!updated.ok) {
      return NextResponse.json({ error: updated.error }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      creditsValidUntil,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[paypal/cancel-subscription]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
