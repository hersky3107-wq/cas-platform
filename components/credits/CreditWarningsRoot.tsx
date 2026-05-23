'use client'

import { usePathname } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CreditActionModal, TOP_UP_DEFAULT_USD } from '@/components/credits/CreditActionModal'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import {
  creditsPercentFull,
  isCreditTier1Low,
  isCreditTier2Low,
  isCreditTier3Zero,
} from '@/lib/credits-warning-tiers'
import {
  isSubscriptionPlanType,
  type SubscriptionPlanType,
} from '@/lib/payments/subscription-plans'
import { supabase } from '@/lib/db/supabase'

type CreditsBillingMode = 'subscription' | 'pay_as_you_go' | 'topup'

const PAYMENTS_PATH = '/modes/credits'
const TIER2_SESSION_KEY = 'credit_tier2_session_ok'

function extractCreditBalanceDeep(obj: unknown): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const o = obj as Record<string, unknown>
  if (typeof o.balance === 'number' && Number.isFinite(o.balance)) return o.balance
  if (typeof o.creditsRemaining === 'number' && Number.isFinite(o.creditsRemaining)) {
    return o.creditsRemaining
  }
  for (const v of Object.values(o)) {
    const nested = extractCreditBalanceDeep(v)
    if (nested !== undefined) return nested
  }
  return undefined
}

function wrapEventStreamResponse(res: Response, onBalance: (n: number) => void): Response {
  const ct = res.headers.get('content-type') ?? ''
  if (!res.body || !ct.includes('text/event-stream')) return res

  const decoder = new TextDecoder()
  let buf = ''
  let notified = false

  const transformed = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (!notified) {
          buf += decoder.decode(chunk, { stream: true })
          const m =
            buf.match(/"creditsRemaining"\s*:\s*(\d+)/) ??
            buf.match(/"balance"\s*:\s*(\d+)/)
          if (m) {
            notified = true
            const n = Number(m[1])
            if (Number.isFinite(n)) onBalance(n)
          }
          if (buf.length > 48_000) buf = buf.slice(-24_000)
        }
        controller.enqueue(chunk)
      },
      flush() {
        try {
          decoder.decode()
        } catch {
          /* ignore */
        }
      },
    })
  )

  return new Response(transformed, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}

type CreditWarningsContextValue = {
  balance: number | null
  billingMode: CreditsBillingMode
  percentCeiling: number
  signedIn: boolean
  refreshBalance: () => Promise<void>
}

const CreditWarningsContext = createContext<CreditWarningsContextValue | null>(null)

export function useCreditWarnings(): CreditWarningsContextValue | null {
  return useContext(CreditWarningsContext)
}

function isModulePath(path: string): boolean {
  return path.startsWith('/modes/') && !path.startsWith(PAYMENTS_PATH)
}

export function CreditWarningsRoot({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [signedIn, setSignedIn] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [billingMode, setBillingMode] = useState<CreditsBillingMode>('pay_as_you_go')
  const [percentCeiling, setPercentCeiling] = useState(1000)

  const [tier1Banner, setTier1Banner] = useState(false)
  const [tier2Modal, setTier2Modal] = useState(false)
  const [tier3Modal, setTier3Modal] = useState(false)
  const [activePlanType, setActivePlanType] = useState<SubscriptionPlanType | null>(null)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [topUpAmount, setTopUpAmount] = useState(TOP_UP_DEFAULT_USD)
  const [upgradingPlanType, setUpgradingPlanType] = useState<SubscriptionPlanType | null>(null)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)

  const tier1TimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevPathRef = useRef<string | null>(null)
  const tier1CooldownUntilRef = useRef(0)
  const tier2DismissedRef = useRef(
    typeof window !== 'undefined' && sessionStorage.getItem(TIER2_SESSION_KEY) === '1'
  )

  const percent = useMemo(
    () => (balance !== null ? creditsPercentFull(balance, percentCeiling) : 0),
    [balance, percentCeiling]
  )

  const refreshBalance = useCallback(async () => {
    const res = await authenticatedFetch('/api/credits/balance', {
      method: 'POST',
      json: {},
    })
    const j = (await res.json().catch(() => null)) as {
      balance?: unknown
      billingMode?: unknown
      percentCeiling?: unknown
    } | null
    if (typeof j?.balance === 'number' && Number.isFinite(j.balance)) {
      setBalance(j.balance)
    }
    if (
      j?.billingMode === 'subscription' ||
      j?.billingMode === 'pay_as_you_go' ||
      j?.billingMode === 'topup'
    ) {
      setBillingMode(j.billingMode)
    }
    if (typeof j?.percentCeiling === 'number' && Number.isFinite(j.percentCeiling) && j.percentCeiling >= 1) {
      setPercentCeiling(j.percentCeiling)
    }
  }, [])

  const maybeShowTier1AfterModule = useCallback(
    (newBalance: number) => {
      if (!isCreditTier1Low(newBalance, percentCeiling)) return
      const now = Date.now()
      if (now < tier1CooldownUntilRef.current) return
      tier1CooldownUntilRef.current = now + 1500

      if (tier1TimerRef.current) clearTimeout(tier1TimerRef.current)
      setTier1Banner(true)
      tier1TimerRef.current = setTimeout(() => {
        setTier1Banner(false)
        tier1TimerRef.current = null
      }, 5000)
    },
    [percentCeiling]
  )

  const applyBalanceFromDeductionHint = useCallback((n: number) => {
    setBalance(n)
  }, [])

  /** Fetch tap + SSE balance hints */
  useEffect(() => {
    const prevFetch = window.fetch.bind(window)

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url

      const res = await prevFetch(input, init)

      try {
        const sameOrigin =
          url.startsWith('/api/') ||
          (typeof window !== 'undefined' && url.startsWith(`${window.location.origin}/api/`))

        if (!sameOrigin || !res.ok) {
          return res
        }

        const ct = res.headers.get('content-type') ?? ''
        if (ct.includes('application/json')) {
          const clone = res.clone()
          const j = await clone.json().catch(() => null)
          const b = extractCreditBalanceDeep(j)
          if (b !== undefined) applyBalanceFromDeductionHint(b)
          return res
        }

        if (ct.includes('text/event-stream')) {
          return wrapEventStreamResponse(res, applyBalanceFromDeductionHint)
        }
      } catch {
        /* ignore tap errors */
      }

      return res
    }

    return () => {
      window.fetch = prevFetch
    }
  }, [applyBalanceFromDeductionHint])

  /** Auth + initial balance */
  useEffect(() => {
    let cancelled = false

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return
      const id = Boolean(data.user?.id)
      setSignedIn(id)
      if (id) void refreshBalance()
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_evt, session) => {
      const id = Boolean(session?.user?.id)
      setSignedIn(id)
      if (id) void refreshBalance()
      else {
        setBalance(null)
        setTier1Banner(false)
        setTier2Modal(false)
        setTier3Modal(false)
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [refreshBalance])

  /** Tier 3 blocking while inside modules */
  useEffect(() => {
    if (!signedIn || balance === null) {
      setTier3Modal(false)
      return
    }
    if (isModulePath(pathname) && isCreditTier3Zero(balance)) {
      setTier3Modal(true)
    } else {
      setTier3Modal(false)
    }
  }, [signedIn, balance, pathname])

  /** Tier 2 before / during modules */
  useEffect(() => {
    if (!signedIn || balance === null || !isModulePath(pathname)) {
      setTier2Modal(false)
      return
    }
    if (isCreditTier3Zero(balance)) {
      setTier2Modal(false)
      return
    }
    if (isCreditTier2Low(balance, percentCeiling) && !tier2DismissedRef.current) {
      setTier2Modal(true)
    } else {
      setTier2Modal(false)
    }
  }, [signedIn, balance, pathname, percentCeiling])

  /** Tier 2 dismiss resets when credits rise above tier 2 band */
  useEffect(() => {
    if (balance === null) return
    if (!isCreditTier2Low(balance, percentCeiling)) {
      tier2DismissedRef.current = false
      try {
        sessionStorage.removeItem(TIER2_SESSION_KEY)
      } catch {
        /* ignore */
      }
    }
  }, [balance, percentCeiling])

  /** Tier 1 when leaving a module route */
  useEffect(() => {
    const prev = prevPathRef.current
    prevPathRef.current = pathname
    if (!signedIn || balance === null || prev === null) return

    const leftModule = isModulePath(prev) && !isModulePath(pathname)
    if (leftModule && isCreditTier1Low(balance, percentCeiling)) {
      maybeShowTier1AfterModule(balance)
    }
  }, [pathname, signedIn, balance, percentCeiling, maybeShowTier1AfterModule])

  const fetchSubscriptionForModal = useCallback(async () => {
    setSubscriptionLoading(true)
    setActivePlanType(null)
    try {
      const res = await authenticatedFetch('/api/paypal/subscription-status', {
        method: 'GET',
      })
      const j = (await res.json().catch(() => null)) as {
        subscription?: { planType?: string; status?: string } | null
      } | null
      if (
        res.ok &&
        j?.subscription?.status === 'active' &&
        isSubscriptionPlanType(j.subscription.planType)
      ) {
        setActivePlanType(j.subscription.planType)
      }
    } finally {
      setSubscriptionLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!tier2Modal && !tier3Modal) return
    setTopUpAmount(TOP_UP_DEFAULT_USD)
    setUpgradeError(null)
    setUpgradingPlanType(null)
    void fetchSubscriptionForModal()
  }, [tier2Modal, tier3Modal, fetchSubscriptionForModal])

  const handleUpgrade = useCallback(async (planType: SubscriptionPlanType) => {
    setUpgradingPlanType(planType)
    setUpgradeError(null)
    try {
      const res = await authenticatedFetch('/api/paypal/create-subscription', {
        method: 'POST',
        json: { planType },
      })
      const j = (await res.json()) as { approvalUrl?: string; error?: string }
      if (!res.ok || !j.approvalUrl) {
        throw new Error(j.error ?? 'Could not start upgrade')
      }
      window.location.href = j.approvalUrl
    } catch (e) {
      setUpgradingPlanType(null)
      setUpgradeError(e instanceof Error ? e.message : 'Could not start upgrade')
    }
  }, [])

  const dismissTier2Later = useCallback(() => {
    tier2DismissedRef.current = true
    try {
      sessionStorage.setItem(TIER2_SESSION_KEY, '1')
    } catch {
      /* ignore */
    }
    setTier2Modal(false)
  }, [])

  const dismissTier1Manual = useCallback(() => {
    if (tier1TimerRef.current) clearTimeout(tier1TimerRef.current)
    tier1TimerRef.current = null
    setTier1Banner(false)
  }, [])

  const ctxValue = useMemo<CreditWarningsContextValue>(
    () => ({
      balance,
      billingMode,
      percentCeiling,
      signedIn,
      refreshBalance,
    }),
    [balance, billingMode, percentCeiling, signedIn, refreshBalance]
  )

  const showPaygGauge =
    signedIn &&
    (billingMode === 'pay_as_you_go' || billingMode === 'topup') &&
    balance !== null &&
    !isCreditTier3Zero(balance)

  return (
    <CreditWarningsContext.Provider value={ctxValue}>
      {children}

      {showPaygGauge ? (
        <div
          className="pointer-events-none fixed right-4 top-4 z-[90] w-[min(140px,calc(100vw-2rem))]"
          aria-hidden
        >
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10 shadow-[0_2px_12px_rgba(0,0,0,0.35)]">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                percent <= 10 ? 'bg-red-500' : percent <= 20 ? 'bg-amber-400' : 'bg-emerald-500'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Tier 1 — quiet bottom banner */}
      {tier1Banner ? (
        <div className="fixed inset-x-0 bottom-0 z-[95] flex justify-center pb-[max(1rem,env(safe-area-inset-bottom))] px-4 pointer-events-none">
          <div className="pointer-events-auto flex max-w-lg items-center gap-3 rounded-t-xl bg-zinc-900/95 px-4 py-3 text-sm text-zinc-100 shadow-[0_-8px_30px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-md">
            <span className="flex-1">Your credits are running low.</span>
            <button
              type="button"
              onClick={dismissTier1Manual}
              className="rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      {tier2Modal ? (
        <CreditActionModal
          tier={2}
          billingMode={billingMode}
          activePlanType={activePlanType}
          subscriptionLoading={subscriptionLoading}
          topUpAmount={topUpAmount}
          onTopUpAmountChange={setTopUpAmount}
          upgradingPlanType={upgradingPlanType}
          upgradeError={upgradeError}
          onUpgrade={(planType) => void handleUpgrade(planType)}
          onTopUpInitiated={() => {
            tier2DismissedRef.current = true
          }}
          onDismissLater={dismissTier2Later}
        />
      ) : null}

      {tier3Modal ? (
        <CreditActionModal
          tier={3}
          billingMode={billingMode}
          activePlanType={activePlanType}
          subscriptionLoading={subscriptionLoading}
          topUpAmount={topUpAmount}
          onTopUpAmountChange={setTopUpAmount}
          upgradingPlanType={upgradingPlanType}
          upgradeError={upgradeError}
          onUpgrade={(planType) => void handleUpgrade(planType)}
          onTopUpInitiated={() => {}}
        />
      ) : null}
    </CreditWarningsContext.Provider>
  )
}
