'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import {
  formatSubscriptionPeriodEnd,
  SUBSCRIPTION_PLAN_UI,
} from '@/lib/payments/subscription-display'
import {
  isSubscriptionPlanType,
  type SubscriptionPlanType,
} from '@/lib/payments/subscription-plans'

type SubscriptionInfo = {
  planType: SubscriptionPlanType
  status: string
  currentPeriodEnd: string | null
}

const CANCEL_CONFIRM_MESSAGE =
  'Are you sure you want to cancel? Your credits will remain until end of billing cycle.'

export function SubscriptionSection({
  userId,
  authLoading,
}: {
  userId: string | null
  authLoading: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [fetched, setFetched] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const loadSubscription = useCallback(async () => {
    if (!userId) {
      setSubscription(null)
      setFetched(true)
      return
    }
    setLoading(true)
    try {
      const res = await authenticatedFetch('/api/paypal/subscription-status', {
        method: 'GET',
      })
      const j = (await res.json().catch(() => null)) as {
        subscription?: {
          planType?: string
          status?: string
          currentPeriodEnd?: string | null
        } | null
      } | null
      if (
        res.ok &&
        j?.subscription?.status === 'active' &&
        isSubscriptionPlanType(j.subscription.planType)
      ) {
        setSubscription({
          planType: j.subscription.planType,
          status: j.subscription.status,
          currentPeriodEnd: j.subscription.currentPeriodEnd ?? null,
        })
      } else {
        setSubscription(null)
      }
    } catch {
      setSubscription(null)
    } finally {
      setLoading(false)
      setFetched(true)
    }
  }, [userId])

  useEffect(() => {
    if (authLoading) return
    void loadSubscription()
  }, [authLoading, loadSubscription])

  const handleCancel = useCallback(async () => {
    if (!subscription || cancelling) return
    if (!window.confirm(CANCEL_CONFIRM_MESSAGE)) return

    setCancelling(true)
    setNotice(null)
    try {
      const res = await authenticatedFetch('/api/paypal/cancel-subscription', {
        method: 'POST',
        json: {},
      })
      const j = (await res.json()) as {
        success?: boolean
        creditsValidUntil?: string | null
        error?: string
      }
      if (!res.ok || !j.success) {
        setNotice(j.error ?? 'Could not cancel subscription.')
        return
      }
      const until =
        formatSubscriptionPeriodEnd(j.creditsValidUntil) ??
        formatSubscriptionPeriodEnd(subscription.currentPeriodEnd) ??
        'the end of your billing cycle'
      setNotice(`Subscription cancelled. Credits valid until ${until}.`)
      setSubscription(null)
    } catch {
      setNotice('Could not cancel subscription.')
    } finally {
      setCancelling(false)
    }
  }, [subscription, cancelling])

  if (authLoading || !userId) {
    return null
  }

  const periodLabel = subscription
    ? formatSubscriptionPeriodEnd(subscription.currentPeriodEnd)
    : null

  return (
    <section className="mt-10 border-t border-zinc-800/80 pt-6" aria-labelledby="subscription-settings">
      <h2 id="subscription-settings" className="text-xs text-zinc-500">
        Subscription
      </h2>

      {loading && !fetched ? (
        <p className="mt-2 text-xs text-zinc-600">Loading…</p>
      ) : subscription ? (
        <div className="mt-2 space-y-1 text-xs font-normal text-zinc-500">
          <p>
            {SUBSCRIPTION_PLAN_UI[subscription.planType].label} ·{' '}
            {SUBSCRIPTION_PLAN_UI[subscription.planType].priceLabel}
          </p>
          {periodLabel ? <p>Next billing date: {periodLabel}</p> : null}
          <button
            type="button"
            onClick={() => void handleCancel()}
            disabled={cancelling}
            className="mt-2 rounded border border-zinc-700/80 bg-transparent px-2 py-1 text-[11px] font-normal text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-400 disabled:opacity-50"
          >
            {cancelling ? 'Cancelling…' : 'Cancel Subscription'}
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2 text-xs font-normal text-zinc-500">
          <p>No active subscription</p>
          <Link
            href="/modes/credits"
            className="inline-block text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-400 hover:underline"
          >
            View Plans
          </Link>
        </div>
      )}

      {notice ? (
        <p className="mt-2 text-[11px] font-normal text-zinc-500" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  )
}
