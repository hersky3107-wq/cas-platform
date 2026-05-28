import { createHmac, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { activateSubscriptionForUser, updateSubscriptionStatusByPaypalId, upsertSubscriptionRow } from '@/lib/payments/subscription-db'
import { isSubscriptionPlanType, type SubscriptionPlanType } from '@/lib/payments/subscription-plans'
import { applyTopUpCredits } from '@/lib/payments/topup-credits'
import { creditsFromTopUpUsd } from '@/lib/credits-warning-modal-config'
import { missingSupabaseEnv } from '@/lib/supabase/route-auth'

function requiredPolarWebhookEnv(): string | null {
  if (!process.env.POLAR_WEBHOOK_SECRET?.trim()) return 'POLAR_WEBHOOK_SECRET'
  return null
}

function verifyPolarSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.POLAR_WEBHOOK_SECRET
  if (!secret) return false
  if (!signatureHeader) return false

  // Accept common header formats: "sha256=...", or raw hex.
  const sig = signatureHeader.includes('=')
    ? signatureHeader.split('=')[1]?.trim() ?? ''
    : signatureHeader.trim()

  if (!sig) return false

  const computedHex = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')

  try {
    const a = Buffer.from(sig, 'hex')
    const b = Buffer.from(computedHex, 'hex')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
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
    const sigHeader =
      req.headers.get('polar-signature') ??
      req.headers.get('x-polar-signature') ??
      req.headers.get('Polar-Signature') ??
      req.headers.get('X-Polar-Signature')

    if (!verifyPolarSignature(rawBody, sigHeader)) {
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

      const meta = (dataObj.metadata ?? (dataObj as any).meta ?? null) as unknown
      const userId = parseUserIdFromMeta(meta)
      const planType = parsePlanTypeFromMeta(meta)

      if (!subscriptionId || !userId || !planType) {
        return NextResponse.json({ ok: true })
      }

      const currentPeriodEndRaw =
        asString((dataObj as any).current_period_end) ??
        asString((dataObj as any).currentPeriodEnd) ??
        asString((dataObj as any).ends_at) ??
        asString((dataObj as any).endsAt) ??
        null

      const result = await activateSubscriptionForUser({
        userId,
        paypalSubscriptionId: `polar:${subscriptionId}`,
        planType,
        email: null,
        currentPeriodEnd: currentPeriodEndRaw,
      })

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 500 })
      }

      return NextResponse.json({ ok: true })
    }

    if (eventType === 'subscription.canceled' || eventType === 'subscription.cancelled') {
      const subscriptionId =
        asString(dataObj.id) ??
        asString((dataObj as any).subscription_id) ??
        asString((dataObj as any).subscriptionId)

      if (!subscriptionId) return NextResponse.json({ ok: true })

      const updated = await updateSubscriptionStatusByPaypalId(`polar:${subscriptionId}`, 'cancelled')
      if (!updated.ok) {
        // If not found, accept anyway to avoid retries.
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

      // Record a subscription row as "pending" only if metadata asked for it (avoid clobbering PayPal).
      const planType = parsePlanTypeFromMeta(meta)
      const subscriptionId = asString((dataObj as any).subscription_id)
      if (planType && subscriptionId) {
        await upsertSubscriptionRow({
          userId,
          paypalSubscriptionId: `polar:${subscriptionId}`,
          planType,
          status: 'pending',
        })
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

