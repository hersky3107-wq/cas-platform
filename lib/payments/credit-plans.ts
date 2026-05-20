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
