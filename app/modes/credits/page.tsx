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
import {
  TOP_UP_MAX_USD,
  TOP_UP_MIN_USD,
  TOP_UP_STEP_USD,
} from '@/lib/credits-warning-modal-config'
import { formatSubscriptionPeriodEnd } from '@/lib/payments/subscription-display'
import { creditsForTopUpUsd, parseTopUpAmountParam } from '@/lib/payments/topup'
import { supabase } from '@/lib/db/supabase'
import {
  isSubscriptionPlanType,
  type SubscriptionPlanType,
} from '@/lib/payments/subscription-plans'
import {
  creditsContent,
  detectCreditsLocale,
  type CreditsLocale,
} from '@/lib/credits/content'

/** Fixed sub-$10 "Try It" amount shown as a standalone card above the slider. */
const TRY_IT_USD = 8

function snapTopUpAmount(value: number): number {
  const snapped = Math.round(value / TOP_UP_STEP_USD) * TOP_UP_STEP_USD
  return Math.min(TOP_UP_MAX_USD, Math.max(TOP_UP_MIN_USD, snapped))
}

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

  const [locale, setLocale] = useState<CreditsLocale>('en')
  useEffect(() => { setLocale(detectCreditsLocale()) }, [])
  const t = creditsContent[locale]
  const isRtl = locale === 'ar'

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
  const [subscribingPlanType, setSubscribingPlanType] = useState<SubscriptionPlanType | null>(
    null
  )
  const [subscribingPolarPlanType, setSubscribingPolarPlanType] =
    useState<SubscriptionPlanType | null>(null)
  const [topUpAmount, setTopUpAmount] = useState(TOP_UP_MIN_USD)
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
    if (!window.confirm(t.messages.cancelConfirm)) return

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
        setCancelNotice(j.error ?? t.messages.couldNotCancel)
        return
      }
      const until =
        formatSubscriptionPeriodEnd(j.creditsValidUntil) ??
        formatSubscriptionPeriodEnd(activeSubscription.currentPeriodEnd) ??
        'the end of your billing cycle'
      setCancelNotice(`Subscription cancelled. Credits valid until ${until}.`)
      setActiveSubscription(null)
    } catch {
      setCancelNotice(t.messages.couldNotCancel)
    } finally {
      setCancellingSubscription(false)
    }
  }, [activeSubscription, cancellingSubscription, t])

  const handleTopUpPay = useCallback(async (amountUSD?: number) => {
    const amount = amountUSD ?? topUpAmount
    setTopUpPayingUsd(amount)
    setMessage(null)
    try {
      const res = await authenticatedFetch('/api/paypal/create-topup', {
        method: 'POST',
        json: { amountUSD: amount },
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
  }, [topUpAmount])

  const handlePolarTopUpPay = useCallback(async (amountUSD?: number) => {
    const amount = amountUSD ?? topUpAmount
    setTopUpPolarPayingUsd(amount)
    setMessage(null)
    try {
      const res = await authenticatedFetch('/api/polar/create-topup', {
        method: 'POST',
        json: { amountUSD: amount },
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
  }, [topUpAmount])

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
      setMessage({ type: 'err', text: t.messages.topupCancelled })
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
            text: `${j.creditsAdded ?? creditsForTopUpUsd(amountUSD)} ${t.messages.addedCredits}`,
          })
        }
      } catch {
        setMessage({ type: 'err', text: 'Could not complete top-up payment' })
      } finally {
        setTopUpCapturing(false)
        router.replace('/modes/credits')
      }
    })()
  }, [userId, topupParam, searchParams, router, refreshBalance, t])

  useEffect(() => {
    if (!userId || subscriptionReturnHandled.current) return
    if (topupParam === 'success' || topupParam === 'cancel') return

    if (subscriptionParam === 'cancel') {
      subscriptionReturnHandled.current = true
      setMessage({ type: 'err', text: t.messages.subscriptionCancelled })
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
          setMessage({ type: 'ok', text: t.messages.subscriptionSuccess })
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
    t,
  ])

  const topUpBusy = topUpPayingUsd !== null || topUpPolarPayingUsd !== null
  const tryItCredits = creditsForTopUpUsd(TRY_IT_USD)
  const sliderCredits = creditsForTopUpUsd(topUpAmount)

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0f1e] text-slate-400">
        <p>{t.messages.loading}</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="mx-auto max-w-4xl">
        <Link
          href="/"
          className="text-sm text-cyan-300/90 hover:text-cyan-200"
        >
          {t.back}
        </Link>

        <p className="mt-6 text-xs font-medium uppercase tracking-[0.24em] text-cyan-300/85">
          {t.billing}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-2 max-w-xl text-slate-400">
          {t.subtitle}
        </p>

        <div className="mt-8 rounded-[20px] border border-white/10 bg-[#131c35] px-6 py-5">
          <p className="text-sm text-slate-400">{t.balance.label}</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums text-white">
            {balance === null ? '—' : balance.toLocaleString()}
            <span className="ml-2 text-lg font-normal text-slate-400">{t.balance.unit}</span>
          </p>
        </div>

        {topUpCapturing ? (
          <p className="mt-4 text-sm text-cyan-300" role="status">
            {t.messages.confirmingTopup}
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
            title={t.monthly.title}
            subtitle={t.monthly.subtitle}
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
                      {t.monthly.currentPlanBadge} {SUBSCRIPTION_PLAN_LABEL[planType]}
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
                        {t.monthly.currentPlanBtn}
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => void handleSubscribe(planType)}
                          disabled={subscribingPlanType !== null}
                          className="w-full rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isLoading ? t.monthly.redirectingBtn : t.monthly.subscribeBtn}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handlePolarSubscribe(planType)}
                          disabled={subscribingPolarPlanType !== null}
                          className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isPolarLoading ? t.monthly.redirectingBtn : t.monthly.cardBtn}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {t.monthly.koPaypalNotice !== null ? (
            <p className="mt-2 text-center text-xs text-zinc-500">
              {t.monthly.koPaypalNotice}
            </p>
          ) : null}

          <div className="mt-5">
            <InfoCallout>
              <span className="font-medium text-slate-300">{t.monthly.howItWorks}</span>{' '}
              {t.monthly.howItWorksDetail}
            </InfoCallout>
          </div>
        </section>

        <section className="mt-12" aria-labelledby="tryit-heading">
          <h2 id="tryit-heading" className="sr-only">
            One-time credits
          </h2>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="rounded-[20px] border border-amber-400/40 bg-[#131c35] p-4 shadow-[0_0_28px_rgba(251,191,36,0.12)]">
              <span className="mb-2 inline-block w-fit rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                {t.tryIt.badge}
              </span>
              <h3 className="text-lg font-semibold">{t.tryIt.title}</h3>
              <p className="mt-2 text-sm text-slate-300">
                <span className="text-xl font-bold tabular-nums text-white">
                  {tryItCredits.toLocaleString()} {t.balance.unit}
                </span>
                <span className="text-slate-400"> · {t.tryIt.oneTime}</span>
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void handleTopUpPay(TRY_IT_USD)}
                  disabled={topUpBusy}
                  className="w-full rounded-xl bg-[#0070ba] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#005ea6] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {topUpPayingUsd === TRY_IT_USD ? t.monthly.redirectingBtn : t.tryIt.paypalBtn}
                </button>
                <button
                  type="button"
                  onClick={() => void handlePolarTopUpPay(TRY_IT_USD)}
                  disabled={topUpBusy}
                  className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {topUpPolarPayingUsd === TRY_IT_USD ? t.monthly.redirectingBtn : t.tryIt.cardBtn}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/[0.06] bg-[#0f1629]/60 p-4">
              <h3 className="text-sm font-medium uppercase tracking-widest text-slate-500">
                {t.addCredits.title}
              </h3>
              <p className="mt-2 text-sm text-slate-400">
                <span className="font-semibold tabular-nums text-slate-200">
                  {sliderCredits.toLocaleString()}
                </span>{' '}
                {t.addCredits.creditsFor}{' '}
                <span className="font-semibold tabular-nums text-slate-200">${topUpAmount}</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">{t.addCredits.validity}</p>

              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <label htmlFor="credits-topup-slider" className="text-slate-400">
                    {t.addCredits.adjustLabel}
                  </label>
                  <span className="tabular-nums text-slate-500">
                    {sliderCredits.toLocaleString()} {t.addCredits.creditsUnit}
                  </span>
                </div>
                <input
                  id="credits-topup-slider"
                  type="range"
                  min={TOP_UP_MIN_USD}
                  max={TOP_UP_MAX_USD}
                  step={TOP_UP_STEP_USD}
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(snapTopUpAmount(Number(e.target.value)))}
                  className="w-full accent-slate-500"
                />
                <div className="flex justify-between text-xs tabular-nums text-slate-500">
                  <span>${TOP_UP_MIN_USD}</span>
                  <span className="font-medium text-slate-400">${topUpAmount}</span>
                  <span>${TOP_UP_MAX_USD}</span>
                </div>
              </div>

              <div className="mt-5 space-y-2">
                <button
                  type="button"
                  onClick={() => void handleTopUpPay()}
                  disabled={topUpBusy}
                  className="w-full rounded-xl bg-[#0070ba] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#005ea6] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {topUpPayingUsd === topUpAmount
                    ? t.monthly.redirectingBtn
                    : `${t.addCredits.paypalBtn} $${topUpAmount}`}
                </button>
                <button
                  type="button"
                  onClick={() => void handlePolarTopUpPay()}
                  disabled={topUpBusy}
                  className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {topUpPolarPayingUsd === topUpAmount
                    ? t.monthly.redirectingBtn
                    : t.addCredits.cardBtn}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section
          className="mt-12 rounded-[20px] border border-white/10 bg-[#131c35]/60 p-6"
          aria-labelledby="credit-policy-heading"
        >
          <h2 id="credit-policy-heading" className="text-base font-semibold text-white">
            {t.howCreditsWork.title}
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-400">
            <li>{t.howCreditsWork.bullet1}</li>
            <li>{t.howCreditsWork.bullet2}</li>
            <li>{t.howCreditsWork.bullet3}</li>
          </ul>
        </section>

        {activeSubscription?.status === 'active' ? (
          <div className="mt-16 border-t border-white/[0.06] pt-6 text-center">
            <p className="text-xs font-normal text-zinc-400">
              {t.cancel.currentPlanLabel} {SUBSCRIPTION_PLAN_LABEL[activeSubscription.planType]}
            </p>
            <button
              type="button"
              onClick={() => void handleCancelSubscription()}
              disabled={cancellingSubscription}
              className="mt-2 text-xs font-normal text-zinc-500 underline-offset-2 hover:text-zinc-400 hover:underline disabled:opacity-50"
            >
              {cancellingSubscription ? t.cancel.cancellingBtn : t.cancel.cancelBtn}
            </button>
            {cancelNotice ? (
              <p className="mt-2 text-xs font-normal text-zinc-400" role="status">
                {cancelNotice}
              </p>
            ) : null}
          </div>
        ) : null}

        <p className="mt-8 text-center text-xs text-slate-500">
          {t.footer.prefix}{' '}
          <a href="/terms" className="underline hover:text-slate-300">
            {t.footer.terms}
          </a>
          {t.footer.sep}
          <a href="/privacy" className="underline hover:text-slate-300">
            {t.footer.privacy}
          </a>
          {t.footer.sep}
          <a href="/refund" className="underline hover:text-slate-300">
            {t.footer.refund}
          </a>
          {t.footer.suffix}
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
