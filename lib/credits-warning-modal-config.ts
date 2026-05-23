import type { SubscriptionPlanType } from '@/lib/payments/subscription-plans'

export const TOP_UP_MIN_USD = 10
export const TOP_UP_MAX_USD = 300
export const TOP_UP_DEFAULT_USD = 50
export const TOP_UP_STEP_USD = 10
export const TOP_UP_USD_PER_CREDIT = 0.05

export function creditsFromTopUpUsd(amountUsd: number): number {
  return Math.round(amountUsd / TOP_UP_USD_PER_CREDIT)
}

export function topUpCreditsPath(amountUsd: number): string {
  return `/modes/credits?topup=${amountUsd}`
}

export const UPGRADE_PLAN_DISPLAY: Record<
  Exclude<SubscriptionPlanType, 'light'>,
  { label: string; priceUsd: number; creditsLabel: string }
> = {
  standard: { label: 'Standard', priceUsd: 19, creditsLabel: '400 credits' },
  pro: { label: 'Pro', priceUsd: 38, creditsLabel: '850 credits' },
}

const PLAN_RANK: Record<SubscriptionPlanType, number> = {
  light: 0,
  standard: 1,
  pro: 2,
}

/** Plans strictly higher than the user's current subscription tier. */
export function upgradePlansAbove(
  currentPlan: SubscriptionPlanType
): Exclude<SubscriptionPlanType, 'light'>[] {
  const rank = PLAN_RANK[currentPlan]
  const options: Exclude<SubscriptionPlanType, 'light'>[] = []
  if (rank < PLAN_RANK.standard) options.push('standard')
  if (rank < PLAN_RANK.pro) options.push('pro')
  return options
}
