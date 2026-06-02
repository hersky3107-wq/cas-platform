import { createHmac, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { setCreditsBalance } from '@/lib/credits-server'
import {
  creditsForSubscriptionPlan,
  isSubscriptionPlanType,
  type SubscriptionPlanType,
} from '@/lib/payments/subscription-plans'
import { applyTopUpCredits } from '@/lib/payments/topup-credits'
import { creditsFromTopUpUsd } from '@/lib/credits-warning-modal-config'
import { missingSupabaseEnv } from '@/lib/supabase/route-auth'

function requiredPolarWebhookEnv(): string | null {
  if (!process.env.POLAR_WEBHOOK_SECRET?.trim()) return 'POLAR_WEBHOOK_SECRET'
  return null
}

function verifyPolarSignature(rawBody: string, req: Request): boolean {
  const secret = process.env.POLAR_WEBHOOK_SECRET
  if (!secret) return false

  const sigHeader = req.headers.get('webhook-signature')
  const msgId = req.headers.get('webhook-id')
  const timestamp = req.headers.get('webhook-timestamp')

  if (!sigHeader || !msgId || !timestamp) return false

  const secretClean = secret.replace(/^(polar_whs_|whsec_)/, '')
  const signedContent = `${msgId}.${timestamp}.${rawBody}`

  // Try both: base64-decoded key and raw UTF-8 key
  const keys = [
    Buffer.from(secretClean, 'base64'),
    Buffer.from(secretClean, 'utf8'),
    Buffer.from(secret, 'utf8'),
  ]

  for (const key of keys) {
    const computed = createHmac('sha256', key)
      .update(signedContent, 'utf8')
      .digest('base64')

    const signatures = sigHeader.split(' ')
    for (const sig of signatures) {
      const parts = sig.split(',')
      if (parts.length < 2) continue
      const sigBase64 = parts.slice(1).join(',')
      try {
        const a = Buffer.from(sigBase64, 'base64')
        const b = Buffer.from(computed, 'base64')
        if (a.length === b.length && timingSafeEqual(a, b)) {
          console.log('[polar/webhook] Signature verified successfully')
          return true
        }
      } catch {
        continue
      }
    }
  }

  console.error('[polar/webhook] Signature verification failed { hasSecret: true }')
  return false
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function parsePlanTypeFromMeta(meta: unknown): SubscriptionPlanType | null {
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>
  const pt = m.plan_type
  return isSubscriptionPlanType(pt) ? pt : null
}

function parseUserIdFromMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>
  return asString(m.user_id)
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

    const missingPolar = requiredPolarWebhookEnv()
    if (missingPolar) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missingPolar}` },
        { status: 503 }
      )
    }

    const rawBody = await req.text()
    if (!verifyPolarSignature(rawBody, req)) {
      console.error('[polar/webhook] Signature verification failed', {
        hasSecret: !!process.env.POLAR_WEBHOOK_SECRET,
      })
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    let event: Record<string, unknown>
    try {
      event = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const eventType =
      asString(event.type) ??
      asString((event as any).event) ??
      asString((event as any).name) ??
      ''
    console.log('[polar/webhook] received:', { eventType })

    const data = (event.data ?? (event as any).payload ?? null) as unknown
    const dataObj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null

    // Always return 200 for unrecognized events so Polar doesn't retry indefinitely.
    if (!eventType || !dataObj) {
      return NextResponse.json({ ok: true })
    }

    if (eventType === 'subscription.created' || eventType === 'subscription.updated') {
      const subscriptionId =
        asString(dataObj.id) ??
        asString((dataObj as any).subscription_id) ??
        asString((dataObj as any).subscriptionId)
      console.log('[polar/webhook] subscriptionId:', subscriptionId)

      const meta = (
        dataObj.metadata ??
        (dataObj as any).meta ??
        (dataObj as any).checkout?.metadata ??
        null
      ) as unknown
      const userId = parseUserIdFromMeta(meta)
      const planType = parsePlanTypeFromMeta(meta)
      console.log('[polar/webhook] meta:', JSON.stringify(meta))
      console.log('[polar/webhook] userId:', userId, 'planType:', planType)

      if (!subscriptionId || !userId || !planType) {
        return NextResponse.json({ ok: true })
      }

      const currentPeriodStartRaw =
        asString((dataObj as any).current_period_start) ??
        asString((dataObj as any).currentPeriodStart) ??
        asString((dataObj as any).started_at) ??
        asString((dataObj as any).startedAt) ??
        null

      const currentPeriodEndRaw =
        asString((dataObj as any).current_period_end) ??
        asString((dataObj as any).currentPeriodEnd) ??
        asString((dataObj as any).ends_at) ??
        asString((dataObj as any).endsAt) ??
        null

      const now = new Date().toISOString()
      const creditsPerCycle = creditsForSubscriptionPlan(planType)

      const { error: upsertErr } = await supabaseAdmin
        .from('subscriptions')
        .upsert(
          {
            user_id: userId,
            paypal_subscription_id: `polar:${subscriptionId}`,
            plan_type: planType,
            status: 'active',
            current_period_start: currentPeriodStartRaw,
            current_period_end: currentPeriodEndRaw,
            credits_per_cycle: creditsPerCycle,
            updated_at: now,
          },
          { onConflict: 'user_id' }
        )

      if (upsertErr) {
        return NextResponse.json({ error: upsertErr.message }, { status: 500 })
      }

      const creditsSet = await setCreditsBalance(userId, creditsPerCycle, 'subscription')
      if (!creditsSet.ok) {
        return NextResponse.json(
          { error: creditsSet.reason ?? 'Could not apply subscription credits' },
          { status: 500 }
        )
      }

      return NextResponse.json({ ok: true })
    }

    if (eventType === 'subscription.canceled' || eventType === 'subscription.cancelled') {
      const subscriptionId =
        asString(dataObj.id) ??
        asString((dataObj as any).subscription_id) ??
        asString((dataObj as any).subscriptionId)

      if (!subscriptionId) return NextResponse.json({ ok: true })

      const { error } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('paypal_subscription_id', `polar:${subscriptionId}`)

      if (error) {
        // Accept anyway to avoid retries during testing.
        return NextResponse.json({ ok: true })
      }
      return NextResponse.json({ ok: true })
    }

    if (eventType === 'order.created') {
      // Optional: treat Polar orders as top-ups when metadata contains amount_usd or topup_credits.
      const meta = (dataObj.metadata ?? (dataObj as any).meta ?? null) as unknown
      const userId = parseUserIdFromMeta(meta)
      if (!userId) return NextResponse.json({ ok: true })

      const topupCredits =
        meta && typeof meta === 'object' ? asNumber((meta as any).topup_credits) : null
      const amountUsd =
        meta && typeof meta === 'object' ? asNumber((meta as any).amount_usd) : null

      const creditsToAdd =
        topupCredits && topupCredits > 0
          ? Math.trunc(topupCredits)
          : amountUsd && amountUsd > 0
            ? creditsFromTopUpUsd(Math.trunc(amountUsd))
            : null

      if (!creditsToAdd) return NextResponse.json({ ok: true })

      const applied = await applyTopUpCredits(userId, creditsToAdd)
      if (!applied.ok) {
        return NextResponse.json({ error: applied.reason }, { status: 500 })
      }

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[polar/webhook]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

