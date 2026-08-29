/**
 * Contract-neutral grading sides — pure, no I/O.
 *
 * The grading engine (`grading-core.ts`) and the price resolver
 * (`resolution.ts`) are DELIBERATELY untouched: they speak the hardened
 * binary vocabulary `'up' | 'down'` (`ResolutionDirection`). This module is
 * the seam that maps that binary outcome onto the round's answer-contract
 * side pair at the STORE layer (`reconciliation.ts`):
 *
 *   'up'   → side A (first token of the pair:  up / yes / above)
 *   'down' → side B (second token of the pair: down / no / below)
 *
 * For binary_close_higher the pair IS ('up','down'), so the mapping is the
 * identity and every persisted query/string is byte-identical to the
 * pre-generalization ternary (proved in __tests__/graded-sides.test.ts with
 * the frozen pre-refactor logic). A future non-price grading executor
 * resolves its round to the same binary outcome ("the named subject achieved
 * it" = 'up' = side A) and this mapping stores yes/no — the two-answers law
 * in grading form.
 */

import { sidePairForKind, type AnswerSide } from '@/lib/league/answer-contract'
import type { ResolutionDirection, ResolvedOutcome } from './resolution'

export type GradedSides = {
  /** Side token whose predictions get is_correct = true. */
  winner: AnswerSide
  /** Side token whose predictions get is_correct = false. */
  loser: AnswerSide
}

/**
 * Maps the engine's binary outcome onto the round's side pair. `kind` is the
 * round's persisted `proposition_kind`; unknown/legacy values take the
 * close_higher pair (every pre-kind round is a price round).
 */
export function gradedSidesFor(kind: unknown, direction: ResolutionDirection): GradedSides {
  const [a, b] = sidePairForKind(kind)
  return direction === 'up' ? { winner: a, loser: b } : { winner: b, loser: a }
}

/**
 * The persisted `actual_outcome` audit string for a round of this kind.
 * close_higher: EXACTLY `outcome.rawOutcome` (`formatRawOutcome`'s output,
 * byte-identical — the winner token IS the actualDirection). Other kinds:
 * the same audit tail with the leading token replaced by the contract-side
 * winner, so the stored outcome speaks the round's own vocabulary.
 */
export function formatOutcomeForKind(kind: unknown, outcome: ResolvedOutcome): string {
  const { winner } = gradedSidesFor(kind, outcome.actualDirection)
  if (winner === outcome.actualDirection) return outcome.rawOutcome
  return `${winner}${outcome.rawOutcome.slice(outcome.actualDirection.length)}`
}
