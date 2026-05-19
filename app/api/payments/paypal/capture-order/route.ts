import { NextResponse } from 'next/server'
import { sendPaymentConfirmationEmail } from '@/lib/email/payment-confirmation'
import { addCreditsBalance, getCreditsBalance } from '@/lib/credits-server'
import { getCreditPlan, isCreditPlanId } from '@/lib/payments/credit-plans'
import {
  capturePayPalOrder,
  missingPayPalServerEnv,
  parseCapturedPlanFromOrder,
} from '@/lib/payments/paypal'
import {
  isPayPalOrderRecorded,
  recordPayPalPurchase,
} from '@/lib/payments/paypal-capture-store'
import { supabaseAdmin } from '@/lib/supabase/server'
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

    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : ''
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    }

    if (await isPayPalOrderRecorded(supabaseAdmin, orderId)) {
      const balance = await getCreditsBalance(supabaseAdmin, user.id)
      return NextResponse.json({
        ok: true,
        alreadyCaptured: true,
        balance: balance ?? 0,
      })
    }

    const capture = await capturePayPalOrder(orderId)

    if (capture.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: `Payment not completed (status: ${capture.status})` },
        { status: 400 }
      )
    }

    const { planId: capturedPlanId, userId: capturedUserId } = parseCapturedPlanFromOrder(capture)

    if (capturedUserId && capturedUserId !== user.id) {
      return NextResponse.json({ error: 'Order does not belong to this account' }, { status: 403 })
    }

    const planIdFromBody = isCreditPlanId(body.planId) ? body.planId : null
    const planId = planIdFromBody ?? (isCreditPlanId(capturedPlanId) ? capturedPlanId : null)

    if (!planId) {
      return NextResponse.json({ error: 'Could not determine credit plan for order' }, { status: 400 })
    }

    const plan = getCreditPlan(planId)
    if (!plan) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const recorded = await recordPayPalPurchase(supabaseAdmin, {
      paypalOrderId: orderId,
      userId: user.id,
      planId: plan.id,
      creditsGranted: plan.credits,
      amountUsd: Number(plan.priceUsd),
    })

    if (!recorded.ok && recorded.duplicate) {
      const balance = await getCreditsBalance(supabaseAdmin, user.id)
      return NextResponse.json({
        ok: true,
        alreadyCaptured: true,
        balance: balance ?? 0,
      })
    }

    if (!recorded.ok) {
      return NextResponse.json({ error: 'Could not record purchase' }, { status: 500 })
    }

    const grant = await addCreditsBalance(supabaseAdmin, user.id, plan.credits)
    if (!grant.ok) {
      return NextResponse.json({ error: 'Payment captured but credits could not be added' }, { status: 500 })
    }

    void sendPaymentConfirmationEmail(supabaseAdmin, {
      userId: user.id,
      toEmail: user.email,
      creditsPurchased: plan.credits,
      totalCredits: grant.balance,
      transactionId: orderId,
    })

    return NextResponse.json({
      ok: true,
      balance: grant.balance,
      creditsAdded: plan.credits,
      planId: plan.id,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[paypal/capture-order]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
