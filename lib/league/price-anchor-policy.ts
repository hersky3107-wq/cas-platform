/**
 * Price-anchor gate — PURE.
 *
 * 2026-08-21 grading contract: a binary_close_higher round is never graded
 * without a persisted `anchor_price`. The corollary (2026-09-14): a press
 * that cannot obtain that anchor must not charge, and a job that reaches
 * the runner without one must terminate and refund rather than fan out.
 *
 * Subject-outcome and threshold rounds have no price baseline — they skip.
 * A missing/unknown kind defaults to close-higher (the DB default and every
 * catalog chip).
 */

export const MARKET_DATA_UNAVAILABLE_CODE = 'market_data_unavailable' as const

export type PriceAnchorFacts = {
  propositionKind: string | null | undefined
  anchorPrice: number | null | undefined
}

export type PriceAnchorGateDecision = { action: 'proceed' } | { action: 'fail'; reason: 'missing_anchor' }

export function hasUsableAnchor(price: number | null | undefined): boolean {
  return typeof price === 'number' && Number.isFinite(price)
}

export function propositionNeedsPriceAnchor(kind: string | null | undefined): boolean {
  return kind == null || kind === 'binary_close_higher'
}

export function decidePriceAnchorGate(facts: PriceAnchorFacts): PriceAnchorGateDecision {
  if (!propositionNeedsPriceAnchor(facts.propositionKind)) return { action: 'proceed' }
  if (hasUsableAnchor(facts.anchorPrice)) return { action: 'proceed' }
  return { action: 'fail', reason: 'missing_anchor' }
}

/** Catalog ranked chips are always close-higher — they need an open-time anchor. */
export function catalogRoundNeedsPriceAnchor(): boolean {
  return true
}
