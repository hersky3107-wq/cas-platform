/**
 * Auto-grade a housing round from first-published index levels.
 * Up/down is current vs the prior period’s first print.
 * An exact tie follows the price rule: nobody is graded.
 * A missing print stays pending until 10 days after the expected release,
 * then the round goes to the manual queue.
 */

import type { OfficialOutcomeResolution } from '@/lib/prediction/grading-core'

export const HOUSING_GRADE_GRACE_DAYS = 10
const DAY_MS = 86_400_000

export type HousingGradeInput = {
  current: number | null
  prior: number | null
  /** Basis points of one percent. 1% = 100. Null means any rise. */
  thresholdBp: number | null
  nowMs: number
  expectedReleaseMs: number
  graceDays?: number
  evidence: string
}

export type HousingGradeDecision =
  | { kind: 'pending'; detail: string }
  | { kind: 'manual'; detail: string }
  | { kind: 'equal'; detail: string }
  | { kind: 'up' | 'down'; changePct: number; detail: string }

export function decideHousingGrade(input: HousingGradeInput): HousingGradeDecision {
  const grace = (input.graceDays ?? HOUSING_GRADE_GRACE_DAYS) * DAY_MS
  if (input.current == null || input.prior == null || input.prior === 0) {
    const why = input.current == null ? 'referenced print is not stored' : 'prior first-published print is missing'
    if (input.nowMs < input.expectedReleaseMs + grace) {
      return { kind: 'pending', detail: `${why}. ${input.evidence}` }
    }
    return { kind: 'manual', detail: `${why} after the release grace. ${input.evidence}` }
  }
  const changePct = ((input.current - input.prior) / input.prior) * 100
  const bar = input.thresholdBp == null ? 0 : input.thresholdBp / 100
  const detail = `${input.evidence} change ${changePct.toFixed(4)}%`
  if (input.thresholdBp == null) {
    if (input.current > input.prior) return { kind: 'up', changePct, detail }
    if (input.current < input.prior) return { kind: 'down', changePct, detail }
    return { kind: 'equal', detail }
  }
  if (changePct > bar) return { kind: 'up', changePct, detail }
  if (changePct < bar) return { kind: 'down', changePct, detail }
  return { kind: 'equal', detail }
}

export function housingGradeToOfficial(
  decision: HousingGradeDecision,
  args: { current: number | null; prior: number | null; refPeriod: string; seenAt: string },
): OfficialOutcomeResolution | null {
  if (decision.kind === 'manual') return null
  if (decision.kind === 'pending') return { status: 'pending', detail: decision.detail }
  if (decision.kind === 'equal') return { status: 'equal', detail: decision.detail }
  return {
    status: 'resolved',
    outcome: {
      rawOutcome: decision.detail.slice(0, 500),
      actualDirection: decision.kind,
      anchorPrice: args.prior ?? 0,
      anchorPriceAt: args.seenAt,
      resolutionPrice: args.current ?? 0,
      resolutionSessionDate: `${args.refPeriod}-01`,
    },
  }
}
