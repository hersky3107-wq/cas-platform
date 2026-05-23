'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import { supabase } from '@/lib/db/supabase'
import { CREDIT_PLANS, type CreditPlanId } from '@/lib/payments/credit-plans'
import {
  isSubscriptionPlanType,
  type SubscriptionPlanType,
} from '@/lib/payments/subscription-plans'

const PLAN_ORDER: CreditPlanId[] = ['starter', 'popular', 'pro']

const SUBSCRIPTION_ORDER: SubscriptionPlanType[] = ['light', 'standard', 'pro']

const SUBSCRIPTION_PLANS: Record<
  SubscriptionPlanType,
  { label: string; priceUsd: string }
> = {
  light: { label: 'Light', priceUsd: '10' },
  standard: { label: 'Standard', priceUsd: '19' },
  pro: { label: 'Pro', priceUsd: '38' },
}

const SUBSCRIPTION_PLAN_LABEL: Record<SubscriptionPlanType, string> = {
  light: 'Light',
  standard: 'Standard',
  pro: 'Pro',
}

const PAYMENT_FAILED_MESSAGE = 'Payment failed. Please try again or contact support.'
const PAYMENT_CANCELLED_MESSAGE = 'Payment cancelled.'
const SUBSCRIPTION_CANCELLED_MESSAGE = 'Subscription cancelled.'
const SUBSCRIPTION_SUCCESS_MESSAGE = 'Your monthly plan is active. Thank you!'

type PayPalButtonsInstance = {
  render: (selector: string | HTMLElement) => Promise<void>
  close?: () => void
}

type PayPalSdk = {
  Buttons: (config: {
    style?: { layout?: string; shape?: string; label?: string; color?: string }
    createOrder: () => Promise<string>
    onApprove: (data: { orderID: string }) => Promise<void>
    onError?: (err: unknown) => void
    onCancel?: (data?: Record<string, unknown>) => void
  }) => PayPalButtonsInstance
}

declare global {
  interface Window {
    paypal?: PayPalSdk
  }
}

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

function OrDivider() {
  return (
    <div className="my-12 flex items-center gap-4" role="separator" aria-label="or">
      <div className="h-px flex-1 bg-white/10" />
      <span className="shrink-0 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
        or
      </span>
      <div className="h-px flex-1 bg-white/10" />
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
  const statusParam = searchParams.get('status')
  const subscriptionParam = searchParams.get('subscription')

  const [authLoading, setAuthLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [paypalReady, setPaypalReady] = useState(false)
  const [paypalError, setPaypalError] = useState<string | null>(null)
  const [planPaypalMessage, setPlanPaypalMessage] = useState<Partial<Record<CreditPlanId, string>>>(
    {}
  )
  const [activeSubscription, setActiveSubscription] = useState<{
    planType: SubscriptionPlanType
    status: string
  } | null>(null)
  const [subscribingPlanType, setSubscribingPlanType] = useState<SubscriptionPlanType | null>(
    null
  )
  const buttonsRendered = useRef(false)
  const planMessageTimers = useRef<Partial<Record<CreditPlanId, ReturnType<typeof setTimeout>>>>({})
  const subscriptionReturnHandled = useRef(false)

  const clearPlanPaypalTimers = useCallback(() => {
    for (const id of PLAN_ORDER) {
      const t = planMessageTimers.current[id]
      if (t) clearTimeout(t)
      delete planMessageTimers.current[id]
    }
  }, [])

  const flashPlanPaypalMessage = useCallback((planId: CreditPlanId, text: string) => {
    const prev = planMessageTimers.current[planId]
    if (prev) clearTimeout(prev)
    setPlanPaypalMessage((m) => ({ ...m, [planId]: text }))
    planMessageTimers.current[planId] = setTimeout(() => {
      setPlanPaypalMessage((m) => {
        const next = { ...m }
        delete next[planId]
        return next
      })
      delete planMessageTimers.current[planId]
    }, 5000)
  }, [])

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
    return () => {
      clearPlanPaypalTimers()
    }
  }, [clearPlanPaypalTimers])

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
    if (subscriptionParam) return
    if (statusParam === 'success') {
      setMessage({ type: 'ok', text: 'Payment approved. Credits are being added to your account.' })
    } else if (statusParam === 'cancelled') {
      setMessage({ type: 'err', text: PAYMENT_CANCELLED_MESSAGE })
    }
  }, [statusParam, subscriptionParam])

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

  useEffect(() => {
    if (!userId) return

    let cancelled = false

    async function loadPayPal() {
      try {
        const cfgRes = await fetch('/api/payments/paypal/client-id')
        const cfg = (await cfgRes.json()) as { clientId?: string; sandbox?: boolean; error?: string }
        if (!cfgRes.ok || !cfg.clientId) {
          throw new Error(cfg.error ?? 'PayPal is not configured')
        }

        const sdkHost = cfg.sandbox ? 'https://www.sandbox.paypal.com' : 'https://www.paypal.com'
        const src = `${sdkHost}/sdk/js?client-id=${encodeURIComponent(cfg.clientId)}&currency=USD&intent=capture`

        await new Promise<void>((resolve, reject) => {
          if (window.paypal) {
            resolve()
            return
          }
          const existing = document.querySelector<HTMLScriptElement>('script[data-paypal-sdk]')
          if (existing) {
            existing.addEventListener('load', () => resolve())
            existing.addEventListener('error', () => reject(new Error('PayPal SDK failed to load')))
            return
          }
          const script = document.createElement('script')
          script.src = src
          script.async = true
          script.dataset.paypalSdk = 'true'
          script.onload = () => resolve()
          script.onerror = () => reject(new Error('PayPal SDK failed to load'))
          document.body.appendChild(script)
        })

        if (!cancelled) {
          setPaypalReady(true)
          setPaypalError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setPaypalError(e instanceof Error ? e.message : 'Could not load PayPal')
        }
      }
    }

    void loadPayPal()
    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    if (!paypalReady || !userId || !window.paypal || buttonsRendered.current) return

    buttonsRendered.current = true

    for (const planId of PLAN_ORDER) {
      const plan = CREDIT_PLANS[planId]
      const container = document.getElementById(`paypal-button-${planId}`)
      if (!container) continue

      window.paypal
        .Buttons({
          style: {
            layout: 'vertical',
            shape: 'rect',
            label: 'paypal',
            color: 'gold',
          },
          createOrder: async () => {
            setMessage(null)
            clearPlanPaypalTimers()
            setPlanPaypalMessage({})
            const res = await authenticatedFetch('/api/payments/paypal/create-order', {
              method: 'POST',
              json: { planId },
            })
            const j = (await res.json()) as { orderId?: string; error?: string }
            if (!res.ok || !j.orderId) {
              throw new Error(j.error ?? 'Could not create PayPal order')
            }
            return j.orderId
          },
          onApprove: async (data) => {
            const res = await authenticatedFetch('/api/payments/paypal/capture-order', {
              method: 'POST',
              json: { orderId: data.orderID, planId },
            })
            const j = (await res.json()) as {
              ok?: boolean
              balance?: number
              creditsAdded?: number
              creditsGrantFailed?: boolean
              error?: string
            }
            if (!res.ok) {
              flashPlanPaypalMessage(planId, PAYMENT_FAILED_MESSAGE)
              return
            }
            if (j.creditsGrantFailed) {
              if (typeof j.balance === 'number') {
                setBalance(j.balance)
              } else {
                await refreshBalance()
              }
              setMessage({
                type: 'ok',
                text: 'Payment received. If your balance does not update shortly, please contact support.',
              })
              return
            }
            if (typeof j.balance === 'number') {
              setBalance(j.balance)
            } else {
              await refreshBalance()
            }
            setMessage({
              type: 'ok',
              text: `Added ${j.creditsAdded ?? plan.credits} credits. Thank you!`,
            })
          },
          onError: () => {
            flashPlanPaypalMessage(planId, PAYMENT_FAILED_MESSAGE)
          },
          onCancel: () => {
            flashPlanPaypalMessage(planId, PAYMENT_CANCELLED_MESSAGE)
          },
        })
        .render(container)
        .catch((e: unknown) => {
          console.warn(`[paypal] render ${planId}`, e)
        })
    }
  }, [paypalReady, userId, refreshBalance, flashPlanPaypalMessage, clearPlanPaypalTimers])

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
          Subscribe for monthly credits or top up once. Use credits across Compare, Arena, Oracle,
          and other modes.
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

        {paypalError ? (
          <p className="mt-4 text-sm text-amber-400">{paypalError}</p>
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

        <OrDivider />

        <section aria-labelledby="top-up-heading">
          <SectionHeader
            id="top-up-heading"
            title="Top-up Credits"
            subtitle="One-time purchase. Credits valid for 90 days."
          />

          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            {PLAN_ORDER.map((planId) => {
              const plan = CREDIT_PLANS[planId]
              const highlighted = planId === 'popular'
              const promo = plan.promoBadge
              return (
                <div
                  key={planId}
                  className={`flex flex-col rounded-[20px] border p-5 ${planCardClass(highlighted)}`}
                >
                  {promo ? (
                    <span className="mb-2 w-fit rounded-full bg-cyan-400/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                      {promo}
                    </span>
                  ) : null}
                  <h3 className="text-lg font-semibold">{plan.label}</h3>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-white">
                    ${plan.priceUsd.replace('.00', '')}
                  </p>
                  <p className="mt-2 text-sm text-slate-300">{plan.displayCreditsLine}</p>
                  <div className="mt-5 min-h-[45px] flex-1" id={`paypal-button-${planId}`} />
                  {planPaypalMessage[planId] ? (
                    <p className="mt-2 text-xs text-red-400" role="alert">
                      {planPaypalMessage[planId]}
                    </p>
                  ) : null}
                  {!paypalReady && !paypalError ? (
                    <p className="mt-2 text-xs text-slate-500">Loading PayPal…</p>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div className="mt-5">
            <InfoCallout>
              Top-up credits are used after your monthly credits run out. Valid for 90 days from
              purchase date.
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
            <li>Top-up credits activate when monthly credits run out</li>
            <li>Monthly credits reset each billing cycle (no rollover)</li>
            <li>Top-up credits expire 90 days after purchase</li>
            <li>Cancel your plan anytime from account settings</li>
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
