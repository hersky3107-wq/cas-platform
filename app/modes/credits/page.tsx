'use client'

import Link from 'next/link'
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import { formatSubscriptionPeriodEnd } from '@/lib/payments/subscription-display'
import { creditsForTopUpUsd, parseTopUpAmountParam } from '@/lib/payments/topup'
import { ONE_TIME_TIERS } from '@/lib/payments/credit-plans'
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
const SUBSCRIPTION_CANCEL_CONFIRM_MESSAGE =
  'Are you sure you want to cancel? Your credits will remain until end of billing cycle.'
const TOPUP_CANCELLED_MESSAGE = 'Top-up payment cancelled.'
const TOPUP_SUCCESS_MESSAGE = 'Top-up complete. Credits have been added to your account.'

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
  const topupParam = searchParams.get('topup')

  const [authLoading, setAuthLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [activeSubscription, setActiveSubscription] = useState<{
    planType: SubscriptionPlanType
    status: string
    currentPeriodEnd: string | null
    subscriptionId: string | null
  } | null>(null)
  const [cancellingSubscription, setCancellingSubscription] = useState(false)
  const [cancelNotice, setCancelNotice] = useState<string | null>(null)
  const [showKoPayPalNotice, setShowKoPayPalNotice] = useState(false)
  const [subscribingPlanType, setSubscribingPlanType] = useState<SubscriptionPlanType | null>(
    null
  )
  const [subscribingPolarPlanType, setSubscribingPolarPlanType] =
    useState<SubscriptionPlanType | null>(null)
  const [topUpPayingUsd, setTopUpPayingUsd] = useState<number | null>(null)
  const [topUpPolarPayingUsd, setTopUpPolarPayingUsd] = useState<number | null>(null)
  const [topUpCapturing, setTopUpCapturing] = useState(false)
  const subscriptionReturnHandled = useRef(false)
  const topupReturnHandled = useRef(false)

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
      subscription?: {
        planType?: string
        status?: string
        currentPeriodEnd?: string | null
        subscriptionId?: string | null
      } | null
      error?: string
    }
    if (!res.ok) return
    const sub = j.subscription
    if (
      sub &&
      sub.status === 'active' &&
      isSubscriptionPlanType(sub.planType)
    ) {
      setActiveSubscription({
        planType: sub.planType,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd ?? null,
        subscriptionId: sub.subscriptionId ?? null,
      })
    } else {
      setActiveSubscription(null)
    }
  }, [])

  const handleCancelSubscription = useCallback(async () => {
    if (!activeSubscription || cancellingSubscription) return
    if (!window.confirm(SUBSCRIPTION_CANCEL_CONFIRM_MESSAGE)) return

    setCancellingSubscription(true)
    setCancelNotice(null)
    try {
      const isPolar = activeSubscription.subscriptionId?.startsWith('polar:') ?? false
      const cancelEndpoint = isPolar
        ? '/api/polar/cancel-subscription'
        : '/api/paypal/cancel-subscription'
      const res = await authenticatedFetch(cancelEndpoint, {
        method: 'POST',
        json: {},
      })
      const j = (await res.json()) as {
        success?: boolean
        creditsValidUntil?: string | null
        error?: string
      }
      if (!res.ok || !j.success) {
        setCancelNotice(j.error ?? 'Could not cancel subscription.')
        return
      }
      const until =
        formatSubscriptionPeriodEnd(j.creditsValidUntil) ??
        formatSubscriptionPeriodEnd(activeSubscription.currentPeriodEnd) ??
        'the end of your billing cycle'
      setCancelNotice(`Subscription cancelled. Credits valid until ${until}.`)
      setActiveSubscription(null)
    } catch {
      setCancelNotice('Could not cancel subscription.')
    } finally {
      setCancellingSubscription(false)
    }
  }, [activeSubscription, cancellingSubscription])

  useEffect(() => {
    const lang = navigator.language?.toLowerCase() ?? ''
    setShowKoPayPalNotice(lang.startsWith('ko'))
  }, [])

  const handleTopUpPay = useCallback(async (amountUSD: number) => {
    setTopUpPayingUsd(amountUSD)
    setMessage(null)
    try {
      const res = await authenticatedFetch('/api/paypal/create-topup', {
        method: 'POST',
        json: { amountUSD },
      })
      const j = (await res.json()) as { approvalUrl?: string; error?: string }
      if (!res.ok || !j.approvalUrl) {
        throw new Error(j.error ?? 'Could not start top-up payment')
      }
      window.location.href = j.approvalUrl
    } catch (e) {
      setTopUpPayingUsd(null)
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Could not start top-up payment',
      })
    }
  }, [])

  const handlePolarTopUpPay = useCallback(async (amountUSD: number) => {
    setTopUpPolarPayingUsd(amountUSD)
    setMessage(null)
    try {
      const res = await authenticatedFetch('/api/polar/create-topup', {
        method: 'POST',
        json: { amountUSD },
      })
      const j = (await res.json()) as { checkoutUrl?: string; error?: string }
      if (!res.ok || !j.checkoutUrl) {
        throw new Error(j.error ?? 'Could not start Polar top-up')
      }
      window.location.href = j.checkoutUrl
    } catch (e) {
      setTopUpPolarPayingUsd(null)
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Could not start Polar top-up',
      })
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

  const handlePolarSubscribe = useCallback(async (planType: SubscriptionPlanType) => {
    setSubscribingPolarPlanType(planType)
    setMessage(null)
    try {
      const res = await authenticatedFetch('/api/polar/create-checkout', {
        method: 'POST',
        json: { planType },
      })
      const j = (await res.json()) as { checkoutUrl?: string; error?: string }
      if (!res.ok || !j.checkoutUrl) {
        throw new Error(j.error ?? 'Could not start Polar checkout')
      }
      window.location.href = j.checkoutUrl
    } catch (e) {
      setSubscribingPolarPlanType(null)
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Could not start Polar checkout',
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
    if (!userId || topupReturnHandled.current) return

    if (topupParam === 'cancel') {
      topupReturnHandled.current = true
      setMessage({ type: 'err', text: TOPUP_CANCELLED_MESSAGE })
      router.replace('/modes/credits')
      return
    }

    if (topupParam !== 'success') return

    const amountUSD = parseTopUpAmountParam(searchParams.get('amount'))
    const orderID =
      searchParams.get('token')?.trim() || searchParams.get('orderID')?.trim() || ''

    if (amountUSD === null || !orderID) return

    topupReturnHandled.current = true
    setTopUpCapturing(true)

    void (async () => {
      try {
        const res = await authenticatedFetch('/api/paypal/capture-topup', {
          method: 'POST',
          json: { orderID, amountUSD },
        })
        const j = (await res.json()) as {
          success?: boolean
          creditsAdded?: number
          balance?: number
          error?: string
        }
        if (!res.ok || !j.success) {
          setMessage({
            type: 'err',
            text: j.error ?? 'Could not complete top-up payment',
          })
        } else {
          if (typeof j.balance === 'number') {
            setBalance(j.balance)
          } else {
            await refreshBalance()
          }
          setMessage({
            type: 'ok',
            text: `Added ${j.creditsAdded ?? creditsForTopUpUsd(amountUSD)} credits. ${TOPUP_SUCCESS_MESSAGE}`,
          })
        }
      } catch {
        setMessage({ type: 'err', text: 'Could not complete top-up payment' })
      } finally {
        setTopUpCapturing(false)
        router.replace('/modes/credits')
      }
    })()
  }, [userId, topupParam, searchParams, router, refreshBalance])

  useEffect(() => {
    if (!userId || subscriptionReturnHandled.current) return
    if (topupParam === 'success' || topupParam === 'cancel') return

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
    topupParam,
  ])

  const topUpBusy = topUpPayingUsd !== null || topUpPolarPayingUsd !== null

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

        {topUpCapturing ? (
          <p className="mt-4 text-sm text-cyan-300" role="status">
            Confirming your top-up payment…
          </p>
        ) : null}

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
              const isPolarLoading = subscribingPolarPlanType === planType

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
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => void handleSubscribe(planType)}
                          disabled={subscribingPlanType !== null}
                          className="w-full rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isLoading ? 'Redirecting…' : 'Subscribe'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handlePolarSubscribe(planType)}
                          disabled={subscribingPolarPlanType !== null}
                          className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isPolarLoading ? 'Redirecting…' : 'Pay with Card (Polar)'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <p className="mt-2 text-center text-xs text-zinc-500">
            한국 PayPal 계정은 국내 정책상 자국 서비스 결제가 제한됩니다. 한국 카드는 Polar 결제를 이용해주세요.
            Contact: support@aimani.ai
          </p>

          <div className="mt-5">
            <InfoCallout>
              <span className="font-medium text-slate-300">How monthly credits work:</span>{' '}
              Credits reset every billing cycle. Unused credits do not roll over. Cancel anytime.
            </InfoCallout>
          </div>
        </section>

        <section className="mt-12" aria-labelledby="one-time-credits-heading">
          <h2
            id="one-time-credits-heading"
            className="text-sm font-medium uppercase tracking-widest text-slate-500"
          >
            One-time Credits — no expiry on unused credits
          </h2>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {ONE_TIME_TIERS.map((tier) => {
              const isTryIt = tier.id === 'try_it'
              const payPalLoading = topUpPayingUsd === tier.usd
              const polarLoading = topUpPolarPayingUsd === tier.usd

              return (
                <div
                  key={tier.id}
                  className={`flex flex-col rounded-2xl border bg-[#0f1629]/60 p-4 ${
                    isTryIt ? 'border-white/15' : 'border-white/[0.06]'
                  }`}
                >
                  {tier.label ? (
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                      {tier.label}
                    </p>
                  ) : null}
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                    {tier.credits.toLocaleString()}
                    <span className="ml-1.5 text-sm font-normal text-slate-400">credits</span>
                  </p>
                  <p className="mt-1 text-sm tabular-nums text-slate-300">${tier.usd}</p>
                  {tier.bonus ? (
                    <p className="mt-1 text-xs font-medium text-emerald-400">
                      +{tier.bonus}% bonus
                    </p>
                  ) : null}
                  <div className="mt-auto space-y-2 pt-4">
                    <button
                      type="button"
                      onClick={() => void handleTopUpPay(tier.usd)}
                      disabled={topUpBusy}
                      className="w-full rounded-xl bg-[#0070ba] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#005ea6] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {payPalLoading ? 'Redirecting…' : `Pay $${tier.usd} with PayPal`}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePolarTopUpPay(tier.usd)}
                      disabled={topUpBusy}
                      className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {polarLoading ? 'Redirecting…' : 'Pay with Card (Polar)'}
                    </button>
                  </div>
                </div>
              )
            })}
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

        {activeSubscription?.status === 'active' ? (
          <div className="mt-16 border-t border-white/[0.06] pt-6 text-center">
            <p className="text-xs font-normal text-zinc-400">
              Current plan: {SUBSCRIPTION_PLAN_LABEL[activeSubscription.planType]}
            </p>
            <button
              type="button"
              onClick={() => void handleCancelSubscription()}
              disabled={cancellingSubscription}
              className="mt-2 text-xs font-normal text-zinc-500 underline-offset-2 hover:text-zinc-400 hover:underline disabled:opacity-50"
            >
              {cancellingSubscription ? 'Cancelling…' : 'Cancel Subscription'}
            </button>
            {cancelNotice ? (
              <p className="mt-2 text-xs font-normal text-zinc-400" role="status">
                {cancelNotice}
              </p>
            ) : null}
          </div>
        ) : null}

        <p className="mt-8 text-center text-xs text-slate-500">
          By using AIMANI, you agree to our{' '}
          <a href="/terms" className="underline hover:text-slate-300">
            Terms of Service
          </a>
          {' / '}
          <a href="/privacy" className="underline hover:text-slate-300">
            Privacy Policy
          </a>
          {' / '}
          <a href="/refund" className="underline hover:text-slate-300">
            Refund Policy
          </a>
        </p>
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
