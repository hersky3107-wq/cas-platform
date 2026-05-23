import { NextResponse } from 'next/server'
import { missingPayPalServerEnv } from '@/lib/payments/paypal'
import {
  activatePayPalSubscription,
  getPayPalSubscription,
  nextBillingTimeFromPayPalSubscription,
  parseSubscriptionCustomId,
} from '@/lib/payments/paypal-subscriptions'
import { activateSubscriptionForUser } from '@/lib/payments/subscription-db'
import {
  isSubscriptionPlanType,
  type SubscriptionPlanType,
} from '@/lib/payments/subscription-plans'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

function isActivePayPalStatus(status: string): boolean {
  return status === 'ACTIVE'
}

async function resolveActiveSubscription(subscriptionId: string) {
  let sub = await getPayPalSubscription(subscriptionId)
  if (sub.status === 'APPROVED') {
    sub = await activatePayPalSubscription(subscriptionId)
  }
  return sub
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

    const subscriptionId =
      typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : ''
    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 })
    }

    let planType: SubscriptionPlanType | null = isSubscriptionPlanType(body.planType)
      ? body.planType
      : null

    const sub = await resolveActiveSubscription(subscriptionId)

    if (!isActivePayPalStatus(sub.status)) {
      return NextResponse.json(
        { error: `Subscription not active (status: ${sub.status})` },
        { status: 402 }
      )
    }

    const fromCustom = parseSubscriptionCustomId(sub.custom_id)
    if (fromCustom) {
      if (fromCustom.userId !== user.id) {
        return NextResponse.json(
          { error: 'Subscription does not belong to this account' },
          { status: 403 }
        )
      }
      if (!planType) {
        planType = fromCustom.planType
      }
    }

    if (!planType) {
      return NextResponse.json({ error: 'planType is required' }, { status: 400 })
    }

    const result = await activateSubscriptionForUser({
      userId: user.id,
      paypalSubscriptionId: subscriptionId,
      planType,
      email: user.email ?? null,
      currentPeriodEnd: nextBillingTimeFromPayPalSubscription(sub),
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      balance: result.balance,
      planType,
      subscriptionId,
      status: result.subscription.status,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[paypal/subscription-success]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
