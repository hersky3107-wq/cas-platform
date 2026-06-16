export type OneTimeTierId =
  | 'try_it'
  | 'pack_10'
  | 'pack_20'
  | 'pack_50'
  | 'pack_100'
  | 'pack_300'

export type OneTimeTier = {
  id: OneTimeTierId
  usd: number
  credits: number
  /** Bonus percentage shown on the card, or null for no bonus. */
  bonus: number | null
  /** Optional small label above the card (e.g. "Try It"). */
  label: string | null
}

/** Preset one-time credit tiers. Source of truth for both UI and top-up grant/validation. */
export const ONE_TIME_TIERS: OneTimeTier[] = [
  { id: 'try_it', usd: 8, credits: 150, bonus: null, label: 'Try It' },
  { id: 'pack_10', usd: 10, credits: 200, bonus: null, label: null },
  { id: 'pack_20', usd: 20, credits: 420, bonus: 5, label: null },
  { id: 'pack_50', usd: 50, credits: 1100, bonus: 10, label: null },
  { id: 'pack_100', usd: 100, credits: 2300, bonus: 15, label: null },
  { id: 'pack_300', usd: 300, credits: 7200, bonus: 20, label: null },
]

export function getOneTimeTierByUsd(usd: number): OneTimeTier | null {
  return ONE_TIME_TIERS.find((tier) => tier.usd === usd) ?? null
}

export type CreditPlanId = 'starter' | 'popular' | 'pro'

export type CreditPlan = {
  id: CreditPlanId
  label: string
  priceUsd: string
  priceCents: number
  /** Credits granted to the user after successful payment. */
  credits: number
  /** Short description for PayPal order line items. */
  description: string
  /** Line shown on the buy page (may include bonus copy). */
  displayCreditsLine: string
  /** Optional badge above the title (e.g. free bonus callout). */
  promoBadge?: string
}

export const CREDIT_PLANS: Record<CreditPlanId, CreditPlan> = {
  starter: {
    id: 'starter',
    label: 'Starter',
    priceUsd: '10.00',
    priceCents: 1000,
    credits: 200,
    description: '200 credits',
    displayCreditsLine: '200 credits',
  },
  popular: {
    id: 'popular',
    label: 'Popular',
    priceUsd: '19.00',
    priceCents: 1900,
    credits: 400,
    description: '380 credits + 20 FREE',
    displayCreditsLine: '380 credits + 20 FREE',
    promoBadge: '+ 20 FREE',
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    priceUsd: '38.00',
    priceCents: 3800,
    credits: 850,
    description: '760 credits + 90 FREE',
    displayCreditsLine: '760 credits + 90 FREE',
    promoBadge: '+ 90 FREE',
  },
}

export function isCreditPlanId(value: unknown): value is CreditPlanId {
  return value === 'starter' || value === 'popular' || value === 'pro'
}

export function getCreditPlan(planId: unknown): CreditPlan | null {
  if (!isCreditPlanId(planId)) return null
  return CREDIT_PLANS[planId]
}
