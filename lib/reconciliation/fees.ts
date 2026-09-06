/**
 * 정산대사기 — fee-rate UNITS, made impossible to confuse (Step-2 req. F).
 *
 * Two stores use two different units for the same concept:
 *   - card_issuers.fee_rate          → FRACTION  (0.0015 = 0.15%)
 *   - reconciliation_rules.fee_rate  → PERCENT   (2.5    = 2.5%)
 *
 * A bare `number` fee crossing that boundary caused the original 2.5%-vs-
 * 0.149% defect class. So: no bare numbers. Every fee is a branded object
 * constructed by `fraction()` or `percent()`, and everything downstream
 * (planner, net computation) accepts ONLY `FractionRate`. Converting percent
 * to fraction is a named, explicit call — never an implicit `/100` inline.
 *
 * Pure module: no server imports, safe for tests and (later) UI.
 */

export type FractionRate = {
  readonly unit: 'fraction'
  /** 0.0015 = 0.15%. Always 0 <= value < 1. */
  readonly value: number
}

export type PercentRate = {
  readonly unit: 'percent'
  /** 2.5 = 2.5%. Always 0 <= value < 100. */
  readonly value: number
}

export type FeeRate = FractionRate | PercentRate

/**
 * Build a FractionRate from a card_issuers.fee_rate value.
 * Throws on percent-looking input (>= 1): that is a unit bug, not data.
 */
export function fraction(value: number): FractionRate {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error(
      `fraction(): expected 0 <= value < 1 (a FRACTION like 0.0015), got ${value} — a value >= 1 means percent units leaked in`
    )
  }
  return { unit: 'fraction', value }
}

/** Build a PercentRate from a reconciliation_rules.fee_rate value (2.5 = 2.5%). */
export function percent(value: number): PercentRate {
  if (!Number.isFinite(value) || value < 0 || value >= 100) {
    throw new Error(`percent(): expected 0 <= value < 100 (PERCENT like 2.5), got ${value}`)
  }
  return { unit: 'percent', value }
}

/** The one sanctioned percent → fraction conversion. */
export function toFraction(rate: FeeRate): FractionRate {
  if (rate.unit === 'fraction') return rate
  return { unit: 'fraction', value: rate.value / 100 }
}

export const ZERO_FEE: FractionRate = { unit: 'fraction', value: 0 }

/**
 * Net won expected to land after the fee, rounded to WHOLE WON (Korean bank
 * deposits are integer won). Sign-preserving: a refund (negative gross)
 * yields a negative net that reduces the batch it nets inside.
 *
 * Real-data check (store's measured ~0.15% preferential rate):
 *   netWon(31500, fraction(0.0015)) = 31453  → NH deposit 31,453 exact
 *   netWon(94500, fraction(0.0015)) = 94358  → 하나 deposit 94,359, off by ₩1
 * — which is why matching tolerance must absorb per-sale rounding (see
 * matchToleranceWon).
 */
export function netWon(grossWon: number, fee: FractionRate): number {
  return Math.round(grossWon * (1 - fee.value))
}

/**
 * Won tolerance for comparing an expected net (or a netted batch of n sales)
 * to an actual deposit. Each sale contributes at most ±0.5원 rounding, plus
 * a base of 2원 observed slack (measured ₩1 off on real single-sale data).
 */
export function matchToleranceWon(saleCount: number): number {
  return 2 + Math.max(0, saleCount)
}
