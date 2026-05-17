export type CreditPlanId = 'starter' | 'popular' | 'pro'

export type CreditPlan = {
  id: CreditPlanId
  label: string
  priceUsd: string
  priceCents: number
  credits: number
  description: string
}

export const CREDIT_PLANS: Record<CreditPlanId, CreditPlan> = {
  starter: {
    id: 'starter',
    label: 'Starter',
    priceUsd: '5.00',
    priceCents: 500,
    credits: 100,
    description: '100 credits',
  },
  popular: {
    id: 'popular',
    label: 'Popular',
    priceUsd: '15.00',
    priceCents: 1500,
    credits: 350,
    description: '350 credits',
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    priceUsd: '39.00',
    priceCents: 3900,
    credits: 1000,
    description: '1,000 credits',
  },
}

export function isCreditPlanId(value: unknown): value is CreditPlanId {
  return value === 'starter' || value === 'popular' || value === 'pro'
}

export function getCreditPlan(planId: unknown): CreditPlan | null {
  if (!isCreditPlanId(planId)) return null
  return CREDIT_PLANS[planId]
}
