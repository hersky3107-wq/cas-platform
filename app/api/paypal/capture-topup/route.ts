import { NextResponse } from 'next/server'
import { getCreditsBalance } from '@/lib/credits-server'
import { capturePayPalOrder, missingPayPalServerEnv } from '@/lib/payments/paypal'
import {
  isPayPalOrderRecorded,
  recordPayPalTopUpPurchase,
} from '@/lib/payments/paypal-capture-store'
import { parseTopUpCaptureMeta } from '@/lib/payments/paypal-topup'
import { applyTopUpCredits } from '@/lib/payments/topup-credits'
import {
  creditsForTopUpUsd,
  isValidTopUpAmountUsd,
} from '@/lib/payments/topup'
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

    const orderID = typeof body.orderID === 'string' ? body.orderID.trim() : ''
    if (!orderID) {
      return NextResponse.json({ error: 'orderID is required' }, { status: 400 })
    }

    const amountUSD = body.amountUSD
    if (!isValidTopUpAmountUsd(amountUSD)) {
      return NextResponse.json(
        { error: 'amountUSD must be $8 or a $10 increment from $10 to $300' },
        { status: 400 }
      )
    }

    const creditsExpected = creditsForTopUpUsd(amountUSD)

    if (await isPayPalOrderRecorded(supabaseAdmin, orderID)) {
      const balance = await getCreditsBalance(supabaseAdmin, user.id)
      return NextResponse.json({
        success: true,
        creditsAdded: creditsExpected,
        balance: balance ?? 0,
        alreadyCaptured: true,
      })
    }

    let capture: Awaited<ReturnType<typeof capturePayPalOrder>>
    try {
      capture = await capturePayPalOrder(orderID)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'PayPal capture failed'
      console.error('[paypal/capture-topup] capture error:', msg)
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    if (capture.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: `Payment not completed (status: ${capture.status})` },
        { status: 402 }
      )
    }

    const { amountUsd: capturedAmount, userId: capturedUserId } = parseTopUpCaptureMeta(capture)

    if (capturedUserId && capturedUserId !== user.id) {
      return NextResponse.json({ error: 'Order does not belong to this account' }, { status: 403 })
    }

    if (capturedAmount !== null && capturedAmount !== amountUSD) {
      return NextResponse.json({ error: 'Order amount does not match' }, { status: 400 })
    }

    const recorded = await recordPayPalTopUpPurchase(supabaseAdmin, {
      paypalOrderId: orderID,
      userId: user.id,
      creditsGranted: creditsExpected,
      amountUsd: amountUSD,
    })

    if (!recorded.ok && recorded.duplicate) {
      const balance = await getCreditsBalance(supabaseAdmin, user.id)
      return NextResponse.json({
        success: true,
        creditsAdded: creditsExpected,
        balance: balance ?? 0,
        alreadyCaptured: true,
      })
    }

    if (!recorded.ok) {
      return NextResponse.json({ error: 'Could not record purchase' }, { status: 500 })
    }

    const applied = await applyTopUpCredits(user.id, creditsExpected)
    if (!applied.ok) {
      console.error('[paypal/capture-topup] capture recorded but applyTopUpCredits failed', {
        orderID,
        userId: user.id,
        reason: applied.reason,
      })
      return NextResponse.json(
        { error: 'Payment captured but credits could not be applied. Contact support.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      creditsAdded: creditsExpected,
      balance: applied.balance,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[paypal/capture-topup]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
