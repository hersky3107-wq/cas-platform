import { TOP_UP_USD_PER_CREDIT } from '@/lib/credits-warning-modal-config'
import { getOneTimeTierByUsd } from '@/lib/payments/credit-plans'

export const TOPUP_PLAN_ID = 'topup'

/** Valid top-up amounts are the preset one-time tiers (see ONE_TIME_TIERS). */
export function isValidTopUpAmountUsd(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (!Number.isInteger(value)) return false
  return getOneTimeTierByUsd(value) !== null
}

export function parseTopUpAmountParam(raw: string | null): number | null {
  if (!raw) return null
  const n = Number(raw)
  return isValidTopUpAmountUsd(n) ? n : null
}

/** Credits granted for a top-up amount, taken from the matching tier. */
export function creditsForTopUpUsd(amountUsd: number): number {
  const tier = getOneTimeTierByUsd(amountUsd)
  return tier ? tier.credits : 0
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
