/** Percent full for PAYG gauge & tier thresholds (balance / ceiling, capped at 100). */
export function creditsPercentFull(balance: number, ceiling: number): number {
  if (!Number.isFinite(balance) || !Number.isFinite(ceiling) || ceiling < 1) return 0
  return Math.min(100, Math.round((balance / ceiling) * 100))
}

export function isCreditTier3Zero(balance: number | null): boolean {
  return balance !== null && balance <= 0
}

/** Tier 2: 10% or below, still has credits */
export function isCreditTier2Low(balance: number | null, ceiling: number): boolean {
  if (balance === null || balance <= 0) return false
  return creditsPercentFull(balance, ceiling) <= 10
}

/** Tier 1: 20% or below (includes tier 2 band); caller should prefer tier 2/3 UX first */
export function isCreditTier1Low(balance: number | null, ceiling: number): boolean {
  if (balance === null || balance <= 0) return false
  return creditsPercentFull(balance, ceiling) <= 20
}
