'use client'

import Link from 'next/link'
import {
  creditsFromTopUpUsd,
  TOP_UP_DEFAULT_USD,
  TOP_UP_MAX_USD,
  TOP_UP_MIN_USD,
  TOP_UP_STEP_USD,
  topUpCreditsPath,
  upgradePlansAbove,
  UPGRADE_PLAN_DISPLAY,
} from '@/lib/credits-warning-modal-config'
import type { SubscriptionPlanType } from '@/lib/payments/subscription-plans'

type CreditActionModalProps = {
  tier: 2 | 3
  billingMode: 'subscription' | 'pay_as_you_go'
  activePlanType: SubscriptionPlanType | null
  subscriptionLoading: boolean
  topUpAmount: number
  onTopUpAmountChange: (amount: number) => void
  upgradingPlanType: SubscriptionPlanType | null
  upgradeError: string | null
  onUpgrade: (planType: SubscriptionPlanType) => void
  onTopUpInitiated: () => void
  onDismissLater?: () => void
}

function snapTopUpAmount(value: number): number {
  const snapped = Math.round(value / TOP_UP_STEP_USD) * TOP_UP_STEP_USD
  return Math.min(TOP_UP_MAX_USD, Math.max(TOP_UP_MIN_USD, snapped))
}

export function CreditActionModal({
  tier,
  billingMode,
  activePlanType,
  subscriptionLoading,
  topUpAmount,
  onTopUpAmountChange,
  upgradingPlanType,
  upgradeError,
  onUpgrade,
  onTopUpInitiated,
  onDismissLater,
}: CreditActionModalProps) {
  const isTier3 = tier === 3
  const zClass = isTier3 ? 'z-[110]' : 'z-[100]'
  const backdropClass = isTier3 ? 'bg-black/80 backdrop-blur-sm' : 'bg-black/70 backdrop-blur-[2px]'

  const showUpgradeSection =
    billingMode === 'subscription' &&
    !subscriptionLoading &&
    activePlanType !== null &&
    upgradePlansAbove(activePlanType).length > 0

  const upgradeOptions =
    activePlanType !== null ? upgradePlansAbove(activePlanType) : []

  const topUpCredits = creditsFromTopUpUsd(topUpAmount)
  const topUpHref = topUpCreditsPath(topUpAmount)

  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center ${backdropClass} p-4`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`credit-action-modal-title-${tier}`}
        className="max-h-[min(90vh,720px)] w-full max-w-md overflow-y-auto rounded-2xl bg-zinc-950 p-6 text-zinc-50 shadow-2xl ring-1 ring-white/10"
      >
        <p
          id={`credit-action-modal-title-${tier}`}
          className="text-center text-base leading-relaxed"
        >
          {isTier3
            ? "You're out of credits. Upgrade or top up to continue."
            : "You're almost out of credits."}
        </p>

        {showUpgradeSection ? (
          <div className="mt-5 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Upgrade your plan
            </p>
            {upgradeOptions.map((planType) => {
              const plan = UPGRADE_PLAN_DISPLAY[planType]
              const isLoading = upgradingPlanType === planType
              return (
                <div
                  key={planType}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-zinc-100">{plan.label}</p>
                    <p className="text-sm text-zinc-400">
                      ${plan.priceUsd}/mo · {plan.creditsLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onUpgrade(planType)}
                    disabled={upgradingPlanType !== null}
                    className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoading ? 'Redirecting…' : 'Upgrade'}
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}

        {subscriptionLoading && billingMode === 'subscription' ? (
          <p className="mt-4 text-center text-sm text-zinc-500">Loading plan…</p>
        ) : null}

        {upgradeError ? (
          <p className="mt-3 text-center text-sm text-red-400" role="alert">
            {upgradeError}
          </p>
        ) : null}

        {showUpgradeSection ? (
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="shrink-0 text-xs text-zinc-500">or top up instantly</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>
        ) : (
          <div className="mt-5" />
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <label htmlFor={`topup-slider-${tier}`} className="text-zinc-300">
              Top-up amount
            </label>
            <span className="tabular-nums text-zinc-400">
              {topUpCredits.toLocaleString()} credits
            </span>
          </div>
          <input
            id={`topup-slider-${tier}`}
            type="range"
            min={TOP_UP_MIN_USD}
            max={TOP_UP_MAX_USD}
            step={TOP_UP_STEP_USD}
            value={topUpAmount}
            onChange={(e) => onTopUpAmountChange(snapTopUpAmount(Number(e.target.value)))}
            className="w-full accent-emerald-500"
          />
          <div className="flex justify-between text-xs tabular-nums text-zinc-500">
            <span>${TOP_UP_MIN_USD}</span>
            <span className="font-medium text-zinc-300">${topUpAmount}</span>
            <span>${TOP_UP_MAX_USD}</span>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3">
          <Link
            href={topUpHref}
            onClick={onTopUpInitiated}
            className="rounded-xl bg-emerald-600 px-5 py-3 text-center text-sm font-medium text-white hover:bg-emerald-500"
          >
            Top Up ${topUpAmount}
          </Link>
          {!isTier3 && onDismissLater ? (
            <button
              type="button"
              onClick={onDismissLater}
              className="rounded-xl bg-white/10 px-5 py-3 text-sm font-medium text-zinc-100 hover:bg-white/15"
            >
              Later
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export { TOP_UP_DEFAULT_USD }
