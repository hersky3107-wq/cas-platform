export type SubscriptionPlanType = 'light' | 'standard' | 'pro'

export const SUBSCRIPTION_PLAN_CREDITS: Record<SubscriptionPlanType, number> = {
  light: 200,
  standard: 400,
  pro: 800,
}

const PLAN_ENV_KEYS: Record<SubscriptionPlanType, string> = {
  light: 'PAYPAL_SUBSCRIPTION_PLAN_LIGHT',
  standard: 'PAYPAL_SUBSCRIPTION_PLAN_STANDARD',
  pro: 'PAYPAL_SUBSCRIPTION_PLAN_PRO',
}

export function isSubscriptionPlanType(value: unknown): value is SubscriptionPlanType {
  return value === 'light' || value === 'standard' || value === 'pro'
}

export function getPayPalPlanId(planType: SubscriptionPlanType): string | null {
  const key = PLAN_ENV_KEYS[planType]
  return process.env[key]?.trim() || null
}

export function missingSubscriptionPlanEnv(planType: SubscriptionPlanType): string | null {
  const id = getPayPalPlanId(planType)
  if (!id) return PLAN_ENV_KEYS[planType]
  return null
}

export function creditsForSubscriptionPlan(planType: SubscriptionPlanType): number {
  return SUBSCRIPTION_PLAN_CREDITS[planType]
}
