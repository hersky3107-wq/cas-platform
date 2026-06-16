import {
  TOP_UP_MAX_USD,
  TOP_UP_MIN_USD,
  TOP_UP_STEP_USD,
  TOP_UP_USD_PER_CREDIT,
  creditsFromTopUpUsd,
} from '@/lib/credits-warning-modal-config'
import { getOneTimeTierByUsd } from '@/lib/payments/credit-plans'

export const TOPUP_PLAN_ID = 'topup'

/**
 * Valid top-up amounts: the fixed sub-range tiers (e.g. $8 "Try It") plus any
 * $10 increment from $10 to $300 (the slider range).
 */
export function isValidTopUpAmountUsd(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (!Number.isInteger(value)) return false
  if (value < TOP_UP_MIN_USD && getOneTimeTierByUsd(value) !== null) return true
  if (value < TOP_UP_MIN_USD || value > TOP_UP_MAX_USD) return false
  return value % TOP_UP_STEP_USD === 0
}

export function parseTopUpAmountParam(raw: string | null): number | null {
  if (!raw) return null
  const n = Number(raw)
  return isValidTopUpAmountUsd(n) ? n : null
}

/**
 * Credits granted for a top-up amount. Fixed tiers below the slider range
 * (e.g. $8 → 150) grant their preset credits; all slider amounts are linear.
 */
export function creditsForTopUpUsd(amountUsd: number): number {
  const tier = getOneTimeTierByUsd(amountUsd)
  if (tier && amountUsd < TOP_UP_MIN_USD) return tier.credits
  return creditsFromTopUpUsd(amountUsd)
}

export function formatTopUpUsdForPayPal(amountUsd: number): string {
  return amountUsd.toFixed(2)
}

export function topUpReferenceId(amountUsd: number): string {
  return `${TOPUP_PLAN_ID}_${amountUsd}`
}

export function parseTopUpAmountFromReferenceId(
  referenceId: string | null | undefined
): number | null {
  if (!referenceId?.startsWith(`${TOPUP_PLAN_ID}_`)) return null
  const n = Number(referenceId.slice(TOPUP_PLAN_ID.length + 1))
  return isValidTopUpAmountUsd(n) ? n : null
}

export { TOP_UP_USD_PER_CREDIT }
