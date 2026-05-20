'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import { supabase } from '@/lib/db/supabase'
import { CREDIT_PLANS, type CreditPlanId } from '@/lib/payments/credit-plans'

const PLAN_ORDER: CreditPlanId[] = ['starter', 'popular', 'pro']

const PAYMENT_FAILED_MESSAGE = 'Payment failed. Please try again or contact support.'
const PAYMENT_CANCELLED_MESSAGE = 'Payment cancelled.'

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

function CreditsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const statusParam = searchParams.get('status')

  const [authLoading, setAuthLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [paypalReady, setPaypalReady] = useState(false)
  const [paypalError, setPaypalError] = useState<string | null>(null)
  const [planPaypalMessage, setPlanPaypalMessage] = useState<Partial<Record<CreditPlanId, string>>>(
    {}
  )
  const buttonsRendered = useRef(false)
  const planMessageTimers = useRef<Partial<Record<CreditPlanId, ReturnType<typeof setTimeout>>>>({})

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
    }

    void initAuth()
    return () => {
      cancelled = true
    }
  }, [router, refreshBalance])

  useEffect(() => {
    if (statusParam === 'success') {
      setMessage({ type: 'ok', text: 'Payment approved. Credits are being added to your account.' })
    } else if (statusParam === 'cancelled') {
      setMessage({ type: 'err', text: PAYMENT_CANCELLED_MESSAGE })
    }
  }, [statusParam])

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
          Credits
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Buy credits</h1>
        <p className="mt-2 text-slate-400">
          Use credits across Compare, Arena, Oracle, and other modes.
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

        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {PLAN_ORDER.map((planId) => {
            const plan = CREDIT_PLANS[planId]
            const highlighted = planId === 'popular'
            const promo = plan.promoBadge
            return (
              <div
                key={planId}
                className={`flex flex-col rounded-[20px] border p-5 ${
                  highlighted
                    ? 'border-cyan-400/40 bg-[#131c35] shadow-[0_0_32px_rgba(34,211,238,0.12)]'
                    : 'border-white/10 bg-[#131c35]/80'
                }`}
              >
                {promo ? (
                  <span className="mb-2 w-fit rounded-full bg-cyan-400/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                    {promo}
                  </span>
                ) : null}
                <h2 className="text-lg font-semibold">{plan.label}</h2>
                <p className="mt-1 text-3xl font-bold tabular-nums">
                  ${plan.priceUsd.replace('.00', '')}
                  <span className="text-base font-normal text-slate-400"> USD</span>
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
