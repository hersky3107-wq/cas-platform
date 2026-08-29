/**
 * Binary consensus aggregates — pure math, no I/O.
 *
 * Two parallel methods are always computed:
 *  - majority: count of side-A/side-B (non-answers ignored); probability = mean of stated p
 *  - aggregate: confidence-weighted mean of log-odds of P(side A), converted back
 *
 * SIDE VOCABULARY (2026-08-29): the math is side-token-neutral. Every round
 * has exactly two sides from its answer contract — up/down for
 * binary_close_higher (the default, so all pre-existing call sites are
 * unchanged), yes/no for binary_subject_outcome, above/below for
 * binary_threshold. "side A" is the FIRST token of the pair (up/yes/above);
 * the log-odds aggregate computes P(side A) exactly as it computed P(up).
 * Only the vocabulary is generalized — the 2026-08-24 aggregate math
 * (clamp, logit, confidence weighting, inverse-logit) is byte-identical.
 *
 * Individual model rows are never mutated. UI must not name the method.
 */

/** The default side pair — binary_close_higher's vocabulary. */
export const DEFAULT_SIDES = ['up', 'down'] as const

export type DefaultSide = (typeof DEFAULT_SIDES)[number]

export type BinaryCall<S extends string = DefaultSide> = {
  direction: S
  /** Stated confidence in that direction, 0–100. */
  probability: number
}

export type MajorityConsensus<S extends string = DefaultSide> = {
  direction: S | null
  /** Mean of stated probabilities among binary callers, or null. */
  probability: number | null
  /** Count for side A (first token of the pair: up / yes / above). */
  up: number
  /** Count for side B (second token of the pair: down / no / below). */
  down: number
}

export type LogOddsConsensus<S extends string = DefaultSide> = {
  direction: S | null
  /** Confidence in `direction` after inverse-logit, 0–100, or null. */
  probability: number | null
  /** P(side A) in (0,1) before mapping to direction confidence. */
  pUp: number | null
  n: number
}

export type DualConsensus<S extends string = DefaultSide> = {
  majority: MajorityConsensus<S>
  aggregate: LogOddsConsensus<S>
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

/** Majority vote between the two sides. Non-answer callers never reach here. */
export function majorityConsensus<S extends string = DefaultSide>(
  calls: readonly BinaryCall<S>[],
  sides: readonly [S, S] = DEFAULT_SIDES as unknown as readonly [S, S],
): MajorityConsensus<S> {
  let up = 0
  let down = 0
  let sumP = 0
  let nP = 0
  for (const c of calls) {
    if (c.direction === sides[0]) up += 1
    else down += 1
    if (Number.isFinite(c.probability)) {
      sumP += c.probability
      nP += 1
    }
  }
  const direction: S | null =
    up === 0 && down === 0 ? null : up === down ? null : up > down ? sides[0] : sides[1]
  return {
    direction,
    probability: nP ? round1(sumP / nP) : null,
    up,
    down,
  }
}

/**
 * Confidence-weighted mean of log-odds of P(side A).
 * Weight = stated confidence (clamped unit probability).
 */
export function logOddsConsensus<S extends string = DefaultSide>(
  calls: readonly BinaryCall<S>[],
  sides: readonly [S, S] = DEFAULT_SIDES as unknown as readonly [S, S],
): LogOddsConsensus<S> {
  let sumW = 0
  let sumWLogit = 0
  let n = 0
  for (const c of calls) {
    if (!Number.isFinite(c.probability)) continue
    const conf = clampUnitProbability(c.probability / 100)
    const pUp = c.direction === sides[0] ? conf : 1 - conf
    const w = conf
    sumW += w
    sumWLogit += w * logit(pUp)
    n += 1
  }
  if (n === 0 || sumW <= 0) {
    return { direction: null, probability: null, pUp: null, n: 0 }
  }
  const pUp = sigmoid(sumWLogit / sumW)
  const direction: S = pUp >= 0.5 ? sides[0] : sides[1]
  const probability = round1(100 * (direction === sides[0] ? pUp : 1 - pUp))
  return { direction, probability, pUp, n }
}

export function dualConsensus<S extends string = DefaultSide>(
  calls: readonly BinaryCall<S>[],
  sides: readonly [S, S] = DEFAULT_SIDES as unknown as readonly [S, S],
): DualConsensus<S> {
  return {
    majority: majorityConsensus(calls, sides),
    aggregate: logOddsConsensus(calls, sides),
  }
}

/** Extract binary calls from card/stream model rows (non-side / null skipped). */
export function binaryCallsFromModels<S extends string = DefaultSide>(
  models: readonly { direction: string | null; probability: number | null }[],
  sides: readonly [S, S] = DEFAULT_SIDES as unknown as readonly [S, S],
): BinaryCall<S>[] {
  const out: BinaryCall<S>[] = []
  for (const m of models) {
    if (m.direction !== sides[0] && m.direction !== sides[1]) continue
    if (typeof m.probability !== 'number' || !Number.isFinite(m.probability)) continue
    out.push({ direction: m.direction as S, probability: m.probability })
  }
  return out
}
