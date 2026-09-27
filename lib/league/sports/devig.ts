/**
 * Remove bookmaker overround (juice) so the three (or two) prices become
 * a probability distribution that sums to 1.
 *
 * Multiplicative (proportional): p_i = (1/o_i) / Σ(1/o_j). Simple, biased
 * toward longshots when the juice is not uniform.
 *
 * Shin (1993): one-parameter insider-knowledge model. Solves for z ∈ [0,1)
 * such that the inverted prices sum to 1. Recovers multiplicative at z=0.
 * Favorites typically pick up a bit of the juice the proportional method
 * left on the longshot — closer to a sharp book’s true probability.
 */

import type { DevigMethod, DevigResult, OutcomeProbability } from './types'

export function rawImplied(decimalOdds: number): number {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return 0
  return 1 / decimalOdds
}

export function multiplicativeDevig(odds: readonly number[]): number[] {
  const implied = odds.map(rawImplied)
  const booksum = implied.reduce((a, b) => a + b, 0)
  if (booksum <= 0) return odds.map(() => 0)
  return implied.map((q) => q / booksum)
}

function shinProbabilities(z: number, implied: readonly number[]): number[] {
  const tot = implied.reduce((a, b) => a + b, 0)
  if (tot <= 0) return implied.map(() => 0)
  if (z >= 1) return implied.map(() => 0)
  return implied.map((qi) => {
    const inner = z * z + 4 * (1 - z) * ((qi * qi) / tot)
    return (Math.sqrt(Math.max(0, inner)) - z) / (2 * (1 - z))
  })
}

/**
 * Bisection on z. At z=0 Shin overshoots 1 when the booksum is >1; raising z
 * pulls the mass back onto the unit simplex.
 */
export function shinDevig(odds: readonly number[]): { probabilities: number[]; z: number } {
  const implied = odds.map(rawImplied)
  const booksum = implied.reduce((a, b) => a + b, 0)
  if (booksum <= 0) return { probabilities: odds.map(() => 0), z: 0 }
  if (Math.abs(booksum - 1) < 1e-12) {
    return { probabilities: implied.slice(), z: 0 }
  }

  const sumAt = (z: number) => shinProbabilities(z, implied).reduce((a, b) => a + b, 0)
  if (!(sumAt(0) > 1)) {
    return { probabilities: multiplicativeDevig(odds), z: 0 }
  }

  let lo = 0
  let hi = 0.99
  if (sumAt(hi) > 1) {
    return { probabilities: multiplicativeDevig(odds), z: 0 }
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (sumAt(mid) > 1) lo = mid
    else hi = mid
  }
  const z = (lo + hi) / 2
  return { probabilities: shinProbabilities(z, implied), z }
}

export function roundProb(p: number): number {
  return Math.round(p * 1e6) / 1e6
}

export function devigOutcomes(
  outcomes: ReadonlyArray<{ name: string; price: number }>,
  method: DevigMethod = 'shin'
): { method: DevigMethod; booksum: number; overroundPct: number; shinZ: number | null; outcomes: OutcomeProbability[] } {
  const prices = outcomes.map((o) => o.price)
  const implied = prices.map(rawImplied)
  const booksum = implied.reduce((a, b) => a + b, 0)
  const shin = method === 'shin' ? shinDevig(prices) : null
  const probs = shin ? shin.probabilities : multiplicativeDevig(prices)
  const used: DevigMethod = shin && shin.z > 0 ? 'shin' : 'multiplicative'
  return {
    method: used,
    booksum,
    overroundPct: (booksum - 1) * 100,
    shinZ: shin && used === 'shin' ? shin.z : null,
    outcomes: outcomes.map((o, i) => ({
      name: o.name,
      decimalOdds: o.price,
      rawImplied: implied[i] ?? 0,
      probability: roundProb(probs[i] ?? 0),
    })),
  }
}

export function toDevigResult(args: {
  bookKey: string
  bookTitle: string
  bookClass: 'sharp' | 'recreational'
  outcomes: ReadonlyArray<{ name: string; price: number }>
  limitation: string | null
  method?: DevigMethod
}): DevigResult {
  const inner = devigOutcomes(args.outcomes, args.method ?? 'shin')
  return {
    ...inner,
    bookKey: args.bookKey,
    bookTitle: args.bookTitle,
    bookClass: args.bookClass,
    limitation: args.limitation,
  }
}
