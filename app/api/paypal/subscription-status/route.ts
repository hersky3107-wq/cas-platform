import { NextResponse } from 'next/server'
import { getSubscriptionForUser } from '@/lib/payments/subscription-db'
import { isSubscriptionPlanType } from '@/lib/payments/subscription-plans'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

export async function GET(req: Request) {
  try {
    const missingSb = missingSupabaseEnv()
    if (missingSb) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missingSb}` },
        { status: 503 }
      )
    }

    const { user, error: authErr } = await resolveRouteAuth(req)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const row = await getSubscriptionForUser(user.id)
    if (!row || !isSubscriptionPlanType(row.plan_type)) {
      return NextResponse.json({ subscription: null })
    }

    return NextResponse.json({
      subscription: {
        planType: row.plan_type,
        status: row.status,
        paypalSubscriptionId: row.paypal_subscription_id,
        subscriptionId: row.paypal_subscription_id,
        currentPeriodEnd: row.current_period_end ?? null,
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[paypal/subscription-status]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
