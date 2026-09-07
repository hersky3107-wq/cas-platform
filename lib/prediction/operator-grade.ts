/**
 * Operator-evidence grading — a SIBLING of saveGraded, not a reuse of it.
 *
 * Pure write orchestration (no I/O). Live Supabase deps live in
 * `operator-grade-live.ts` so this module stays unit-testable.
 *
 * saveGraded writes resolution_price / resolution_session_date. Those columns
 * are the price-audit pair. This path must not invent a close.
 *
 * WRITE ORDER (crash-safe against "children graded, outcome missing"):
 *   1. INSERT evidence (PK = round_id). A second submission fails here
 *      (unique violation) and never overwrites. If this is the only write
 *      that landed, the round is still ungraded — no children touched.
 *   2. UPDATE actual_outcome WHERE actual_outcome IS NULL. The public
 *      "this round is graded" fact. Children are still untouched.
 *   3. gradeChildren last. A crash here leaves a graded round with a
 *      source link and unstamped tiles — never tiles stamped against a
 *      missing outcome.
 *
 * Resume: if step 1 hits the PK and the stored URL+fact match this
 * submission and actual_outcome is still null, steps 2–3 continue. That
 * is completion of a crashed first attempt, not an overwrite.
 */

import { sidePairForKind, type AnswerSide } from '@/lib/league/answer-contract'
import type { ResolutionDirection } from './resolution'
import {
  formatOperatorOutcome,
  mapObservedFactToSide,
  validateOperatorEvidenceInput,
} from './operator-map'

export type OperatorRoundRow = {
  id: string
  instrument: string
  category: string
  proposition_kind: string | null
  subject_label: string | null
  actual_outcome: string | null
  resolved_at: string | null
  resolves_at: string
}

export type OperatorEvidenceRow = {
  source_url: string
  observed_fact: string
  derived_side: string
}

export type OperatorGradeInput = {
  roundId: string
  sourceUrl: string
  observedFact: string
  gradedBy: string
}

export type OperatorGradeOk = {
  ok: true
  derived_side: AnswerSide
  actual_outcome: string
  children_graded: number
  resumed: boolean
}

export type OperatorGradeFail = { ok: false; error: string; status: number }
export type OperatorGradeResult = OperatorGradeOk | OperatorGradeFail

export type OperatorGradePlan = { source: string }

export type OperatorGradeDeps = {
  loadRound: (roundId: string) => Promise<OperatorRoundRow | null>
  resolvePlan: (instrument: string, category: string) => OperatorGradePlan
  insertEvidence: (row: {
    roundId: string
    sourceUrl: string
    observedFact: string
    derivedSide: AnswerSide
    gradedBy: string
  }) => Promise<{ ok: true } | { ok: false; unique: boolean; error: string }>
  loadEvidence: (roundId: string) => Promise<OperatorEvidenceRow | null>
  saveOutcome: (roundId: string, actualOutcome: string, nowIso: string) => Promise<boolean>
  gradeChildren: (roundId: string, direction: ResolutionDirection) => Promise<number>
}

function fail(status: number, error: string): OperatorGradeFail {
  return { ok: false, status, error }
}

export function directionForDerivedSide(kind: unknown, derived: AnswerSide): ResolutionDirection {
  const [sideA] = sidePairForKind(kind)
  return derived === sideA ? 'up' : 'down'
}

export async function gradeFromOperatorEvidence(
  input: OperatorGradeInput,
  deps: OperatorGradeDeps
): Promise<OperatorGradeResult> {
  const invalid = validateOperatorEvidenceInput(input.sourceUrl, input.observedFact)
  if (invalid) return fail(400, invalid.error)

  const sourceUrl = input.sourceUrl.trim()
  const observedFact = input.observedFact.trim()

  const round = await deps.loadRound(input.roundId)
  if (!round) return fail(404, 'round not found')
  if (round.actual_outcome != null) return fail(409, 'this round is already graded')
  if (Date.parse(round.resolves_at) > Date.now()) return fail(400, 'this round is not due yet')

  const plan = deps.resolvePlan(round.instrument, round.category)
  if (plan.source !== 'operator_manual') {
    return fail(400, 'this round is not on the operator-manual grade path')
  }

  const mapped = mapObservedFactToSide({
    propositionKind: round.proposition_kind,
    subjectLabel: round.subject_label,
    observedFact,
  })
  if (!mapped.ok) return fail(400, mapped.error)

  const inserted = await deps.insertEvidence({
    roundId: round.id,
    sourceUrl,
    observedFact,
    derivedSide: mapped.derived_side,
    gradedBy: input.gradedBy,
  })

  let resumed = false
  if (!inserted.ok) {
    if (!inserted.unique) return fail(500, inserted.error)
    const existing = await deps.loadEvidence(round.id)
    if (!existing) return fail(409, 'this round already has operator evidence')
    if (existing.source_url !== sourceUrl || existing.observed_fact !== observedFact) {
      return fail(409, 'this round already has operator evidence')
    }
    if (existing.derived_side !== mapped.derived_side) {
      return fail(409, 'this round already has operator evidence')
    }
    resumed = true
  }

  const outcome = formatOperatorOutcome(mapped.derived_side, observedFact)
  const nowIso = new Date().toISOString()
  const saved = await deps.saveOutcome(round.id, outcome, nowIso)
  if (!saved) return fail(409, 'this round is already graded')

  const children = await deps.gradeChildren(
    round.id,
    directionForDerivedSide(round.proposition_kind, mapped.derived_side)
  )

  return {
    ok: true,
    derived_side: mapped.derived_side,
    actual_outcome: outcome,
    children_graded: children,
    resumed,
  }
}
