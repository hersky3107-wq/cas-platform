'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import { supabase } from '@/lib/db/supabase'
import {
  isSubscriptionPlanType,
  type SubscriptionPlanType,
} from '@/lib/payments/subscription-plans'

const SUBSCRIPTION_ORDER: SubscriptionPlanType[] = ['light', 'standard', 'pro']

const SUBSCRIPTION_PLANS: Record<
  SubscriptionPlanType,
  { label: string; priceUsd: string; creditsLine: string }
> = {
  light: { label: 'Light', priceUsd: '10', creditsLine: '200 credits/mo' },
  standard: {
    label: 'Standard',
    priceUsd: '19',
    creditsLine: '380 credits + 20 FREE',
  },
  pro: { label: 'Pro', priceUsd: '38', creditsLine: '760 credits + 90 FREE' },
}

const SUBSCRIPTION_PLAN_LABEL: Record<SubscriptionPlanType, string> = {
  light: 'Light',
  standard: 'Standard',
  pro: 'Pro',
}

const SUBSCRIPTION_CANCELLED_MESSAGE = 'Subscription cancelled.'
const SUBSCRIPTION_SUCCESS_MESSAGE = 'Your monthly plan is active. Thank you!'

function SectionHeader({
  id,
  title,
  subtitle,
}: {
  id?: string
  title: string
  subtitle: string
}) {
  return (
    <header>
      <h2
        id={id}
        className="text-xl font-semibold tracking-tight text-white"
      >
        {title}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{subtitle}</p>
    </header>
  )
}

function InfoCallout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3.5 text-sm leading-relaxed text-slate-400">
      {children}
    </div>
  )
}

function planCardClass(highlighted: boolean) {
  return highlighted
    ? 'border-cyan-400/40 bg-[#131c35] shadow-[0_0_32px_rgba(34,211,238,0.12)]'
    : 'border-white/10 bg-[#131c35]/80'
}

function CreditsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const subscriptionParam = searchParams.get('subscription')

  const [authLoading, setAuthLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [activeSubscription, setActiveSubscription] = useState<{
    planType: SubscriptionPlanType
    status: string
  } | null>(null)
  const [subscribingPlanType, setSubscribingPlanType] = useState<SubscriptionPlanType | null>(
    null
  )
  const subscriptionReturnHandled = useRef(false)

  const refreshBalance = useCallback(async () => {
    const res = await authenticatedFetch('/api/credits/balance', {
      method: 'POST',
      json: {},
    })
    const j = (await res.json().catch(() => null)) as { balance?: number; error?: string }
    if (typeof j?.balance === 'number') {
      setBalance(j.balance)
    }
  }, [])

  const fetchSubscriptionStatus = useCallback(async () => {
    const res = await authenticatedFetch('/api/paypal/subscription-status', {
      method: 'GET',
    })
    const j = (await res.json().catch(() => null)) as {
      subscription?: { planType?: string; status?: string } | null
      error?: string
    }
    if (!res.ok) return
    const sub = j.subscription
    if (
      sub &&
      sub.status === 'active' &&
      isSubscriptionPlanType(sub.planType)
    ) {
      setActiveSubscription({ planType: sub.planType, status: sub.status })
    } else {
      setActiveSubscription(null)
    }
  }, [])

  const handleSubscribe = useCallback(async (planType: SubscriptionPlanType) => {
    setSubscribingPlanType(planType)
    setMessage(null)
    try {
      const res = await authenticatedFetch('/api/paypal/create-subscription', {
        method: 'POST',
        json: { planType },
      })
      const j = (await res.json()) as { approvalUrl?: string; error?: string }
      if (!res.ok || !j.approvalUrl) {
        throw new Error(j.error ?? 'Could not start subscription')
      }
      window.location.href = j.approvalUrl
    } catch (e) {
      setSubscribingPlanType(null)
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Could not start subscription',
      })
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function initAuth() {
      const { data } = await supabase.auth.getUser()
      if (cancelled) return
      const id = data.user?.id ?? null
      setUserId(id)
      setAuthLoading(false)
      if (!id) {
        router.replace('/auth')
        return
      }
      await refreshBalance()
      await fetchSubscriptionStatus()
    }

    void initAuth()
    return () => {
      cancelled = true
    }
  }, [router, refreshBalance, fetchSubscriptionStatus])

  useEffect(() => {
    if (!userId || subscriptionReturnHandled.current) return

    if (subscriptionParam === 'cancel') {
      subscriptionReturnHandled.current = true
      setMessage({ type: 'err', text: SUBSCRIPTION_CANCELLED_MESSAGE })
      router.replace('/modes/credits')
      return
    }

    if (subscriptionParam !== 'success') return

    const planTypeRaw = searchParams.get('planType')
    const subscriptionId =
      searchParams.get('subscription_id')?.trim() ||
      searchParams.get('subscriptionId')?.trim() ||
      ''

    if (!isSubscriptionPlanType(planTypeRaw) || !subscriptionId) return

    subscriptionReturnHandled.current = true

    void (async () => {
      try {
        const res = await authenticatedFetch('/api/paypal/subscription-success', {
          method: 'POST',
          json: { subscriptionId, planType: planTypeRaw },
        })
        const j = (await res.json()) as {
          ok?: boolean
          balance?: number
          error?: string
        }
        if (!res.ok) {
          setMessage({
            type: 'err',
            text: j.error ?? 'Could not activate subscription',
          })
        } else {
          if (typeof j.balance === 'number') {
            setBalance(j.balance)
          } else {
            await refreshBalance()
          }
          setMessage({ type: 'ok', text: SUBSCRIPTION_SUCCESS_MESSAGE })
          await fetchSubscriptionStatus()
        }
      } catch {
        setMessage({ type: 'err', text: 'Could not activate subscription' })
      } finally {
        router.replace('/modes/credits')
      }
    })()
  }, [
    userId,
    subscriptionParam,
    searchParams,
    router,
    refreshBalance,
    fetchSubscriptionStatus,
  ])

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0f1e] text-slate-400">
        <p>Loading…</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/"
          className="text-sm text-cyan-300/90 hover:text-cyan-200"
        >
          ← Back to lobby
        </Link>

        <p className="mt-6 text-xs font-medium uppercase tracking-[0.24em] text-cyan-300/85">
          Billing
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Credits</h1>
        <p className="mt-2 max-w-xl text-slate-400">
          Subscribe for monthly credits. Use credits across Compare, Arena, Oracle, and other modes.
        </p>

        <div className="mt-8 rounded-[20px] border border-white/10 bg-[#131c35] px-6 py-5">
          <p className="text-sm text-slate-400">Current balance</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums text-white">
            {balance === null ? '—' : balance.toLocaleString()}
            <span className="ml-2 text-lg font-normal text-slate-400">credits</span>
          </p>
        </div>

        {message ? (
          <p
            className={`mt-4 text-sm ${message.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}
            role="status"
          >
            {message.text}
          </p>
        ) : null}

        <section className="mt-12" aria-labelledby="monthly-plans-heading">
          <SectionHeader
            id="monthly-plans-heading"
            title="Monthly Plans"
            subtitle="Auto-renews each month. Unused credits expire at end of billing cycle."
          />

          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            {SUBSCRIPTION_ORDER.map((planType) => {
              const plan = SUBSCRIPTION_PLANS[planType]
              const highlighted = planType === 'standard'
              const isActive =
                activeSubscription?.status === 'active' &&
                activeSubscription.planType === planType
              const isLoading = subscribingPlanType === planType

              return (
                <div
                  key={planType}
                  className={`flex flex-col rounded-[20px] border p-5 ${planCardClass(highlighted)}`}
                >
                  {isActive ? (
                    <span className="mb-2 w-fit rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                      Current plan · {SUBSCRIPTION_PLAN_LABEL[planType]}
                    </span>
                  ) : null}
                  <h3 className="text-lg font-semibold">{plan.label}</h3>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-white">
                    ${plan.priceUsd}
                    <span className="text-lg font-semibold text-slate-400">/mo</span>
                  </p>
                  <p className="mt-2 text-sm text-slate-300">{plan.creditsLine}</p>
                  <div className="mt-auto pt-6">
                    {isActive ? (
                      <button
                        type="button"
                        disabled
                        className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-400"
                      >
                        Current plan
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleSubscribe(planType)}
                        disabled={subscribingPlanType !== null}
                        className="w-full rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isLoading ? 'Redirecting…' : 'Subscribe'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-5">
            <InfoCallout>
              <span className="font-medium text-slate-300">How monthly credits work:</span>{' '}
              Credits reset every billing cycle. Unused credits do not roll over. Cancel anytime.
            </InfoCallout>
          </div>
        </section>

        <section
          className="mt-12 rounded-[20px] border border-white/10 bg-[#131c35]/60 p-6"
          aria-labelledby="credit-policy-heading"
        >
          <h2 id="credit-policy-heading" className="text-base font-semibold text-white">
            How credits work
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-400">
            <li>Monthly plan credits are used first</li>
            <li>Monthly credits reset each billing cycle (no rollover)</li>
            <li>Instant top-up available when monthly credits run out</li>
          </ul>
        </section>
      </div>
    </main>
  )
}

export default function CreditsPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#0a0f1e] text-slate-400">
          <p>Loading…</p>
        </main>
      }
    >
      <CreditsContent />
    </Suspense>
  )
}
