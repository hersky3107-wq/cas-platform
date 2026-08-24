/**
 * Binary consensus aggregates — pure math, no I/O.
 *
 * Two parallel methods are always computed:
 *  - majority: count of up/down (flat ignored); probability = mean of stated p
 *  - aggregate: confidence-weighted mean of log-odds of P(up), converted back
 *
 * Individual model rows are never mutated. UI must not name the method.
 */

export type BinaryCall = {
  direction: 'up' | 'down'
  /** Stated confidence in that direction, 0–100. */
  probability: number
}

export type MajorityConsensus = {
  direction: 'up' | 'down' | null
  /** Mean of stated probabilities among binary callers, or null. */
  probability: number | null
  up: number
  down: number
}

export type LogOddsConsensus = {
  direction: 'up' | 'down' | null
  /** Confidence in `direction` after inverse-logit, 0–100, or null. */
  probability: number | null
  /** P(up) in (0,1) before mapping to direction confidence. */
  pUp: number | null
  n: number
}

export type DualConsensus = {
  majority: MajorityConsensus
  aggregate: LogOddsConsensus
}

/**
 * Clamp before logit: stated p=0 / p=100 would be ±∞.
 * Half a percentage point from each edge → [0.5%, 99.5%].
 */
export const LOGIT_CLAMP_LO = 0.005
export const LOGIT_CLAMP_HI = 0.995

export function clampUnitProbability(p: number): number {
  if (!Number.isFinite(p)) return 0.5
  return Math.min(LOGIT_CLAMP_HI, Math.max(LOGIT_CLAMP_LO, p))
}

export function logit(p: number): number {
  const c = clampUnitProbability(p)
  return Math.log(c / (1 - c))
}

export function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x)
    return 1 / (1 + z)
  }
  const z = Math.exp(x)
  return z / (1 + z)
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Majority vote among up/down only. Flat/null callers are ignored. */
export function majorityConsensus(calls: readonly BinaryCall[]): MajorityConsensus {
  let up = 0
  let down = 0
  let sumP = 0
  let nP = 0
  for (const c of calls) {
    if (c.direction === 'up') up += 1
    else down += 1
    if (Number.isFinite(c.probability)) {
      sumP += c.probability
      nP += 1
    }
  }
  const direction: 'up' | 'down' | null =
    up === 0 && down === 0 ? null : up === down ? null : up > down ? 'up' : 'down'
  return {
    direction,
    probability: nP ? round1(sumP / nP) : null,
    up,
    down,
  }
}

/**
 * Confidence-weighted mean of log-odds of P(up).
 * Weight = stated confidence (clamped unit probability).
 */
export function logOddsConsensus(calls: readonly BinaryCall[]): LogOddsConsensus {
  let sumW = 0
  let sumWLogit = 0
  let n = 0
  for (const c of calls) {
    if (!Number.isFinite(c.probability)) continue
    const conf = clampUnitProbability(c.probability / 100)
    const pUp = c.direction === 'up' ? conf : 1 - conf
    const w = conf
    sumW += w
    sumWLogit += w * logit(pUp)
    n += 1
  }
  if (n === 0 || sumW <= 0) {
    return { direction: null, probability: null, pUp: null, n: 0 }
  }
  const pUp = sigmoid(sumWLogit / sumW)
  const direction: 'up' | 'down' = pUp >= 0.5 ? 'up' : 'down'
  const probability = round1(100 * (direction === 'up' ? pUp : 1 - pUp))
  return { direction, probability, pUp, n }
}

export function dualConsensus(calls: readonly BinaryCall[]): DualConsensus {
  return {
    majority: majorityConsensus(calls),
    aggregate: logOddsConsensus(calls),
  }
}

/** Extract binary calls from card/stream model rows (flat/null skipped). */
export function binaryCallsFromModels(
  models: readonly { direction: string | null; probability: number | null }[],
): BinaryCall[] {
  const out: BinaryCall[] = []
  for (const m of models) {
    if (m.direction !== 'up' && m.direction !== 'down') continue
    if (typeof m.probability !== 'number' || !Number.isFinite(m.probability)) continue
    out.push({ direction: m.direction, probability: m.probability })
  }
  return out
}
