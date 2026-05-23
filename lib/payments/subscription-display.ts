import type { SubscriptionPlanType } from '@/lib/payments/subscription-plans'

export const SUBSCRIPTION_PLAN_UI: Record<
  SubscriptionPlanType,
  { label: string; priceLabel: string }
> = {
  light: { label: 'Light', priceLabel: '$10/mo' },
  standard: { label: 'Standard', priceLabel: '$19/mo' },
  pro: { label: 'Pro', priceLabel: '$38/mo' },
}

export function formatSubscriptionPeriodEnd(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
