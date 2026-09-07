/**
 * Operator evidence → side token. Pure: no I/O.
 *
 * The operator never types a side token or "correct"/"incorrect".
 *
 *   binary_close_higher    — refused (price rounds use the feed)
 *   binary_threshold       — numeric compare of the printed value vs the line
 *   binary_subject_outcome — two observation shapes (see observation-shape.ts):
 *     name_match  — normalized equality with subject_label (sports / elections / awards)
 *     occurrence  — structured occurred | did_not_occur; observed_fact is evidence only
 */

import { isPropositionKind, sidePairForKind, type AnswerSide } from '@/lib/league/answer-contract'
import {
  isOccurrenceReport,
  observationShapeForRound,
  type OccurrenceReport,
  type ObservationShape,
} from '@/lib/league/observation-shape'
import { OPERATOR_FORBIDDEN_VERDICT_KEYS } from './operator-form-copy'

export type OperatorMapOk = { ok: true; derived_side: AnswerSide }
export type OperatorMapFail = { ok: false; error: string }
export type OperatorMapResult = OperatorMapOk | OperatorMapFail

const HTTPS_RE = /^https:\/\//i
const NUMBER_RE = /-?\d+(?:\.\d+)?/

export function validateOperatorEvidenceInput(sourceUrl: string, observedFact: string): OperatorMapFail | null {
  const url = sourceUrl.trim()
  const fact = observedFact.trim()
  if (!HTTPS_RE.test(url)) {
    return { ok: false, error: 'source_url must be an https URL' }
  }
  if (fact.length < 1 || fact.length > 500) {
    return { ok: false, error: 'observed_fact must be 1–500 characters' }
  }
  return null
}

export function rejectOperatorVerdictFields(body: unknown): OperatorMapFail | null {
  if (!body || typeof body !== 'object') return null
  const keys = Object.keys(body as Record<string, unknown>)
  const hit = keys.find((k) =>
    (OPERATOR_FORBIDDEN_VERDICT_KEYS as readonly string[]).includes(k)
  )
  if (hit) {
    return { ok: false, error: 'operator cannot submit a side token or a correct/incorrect verdict' }
  }
  return null
}

export function normalizeObservedLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
}

export function parsePrintedNumber(raw: string): number | null {
  const m = raw.replace(/,/g, '').match(NUMBER_RE)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

export function mapObservedFactToSide(input: {
  propositionKind: unknown
  subjectLabel: string | null
  observedFact: string
  /** Persisted on the round. Missing + subject_outcome → legacy name_match. */
  observationShape?: unknown
  /** Required for occurrence; refused on every other shape. */
  occurrence?: unknown
}): OperatorMapResult {
  const fact = input.observedFact.trim()
  if (!fact) return { ok: false, error: 'observed_fact is required' }

  const kind = isPropositionKind(input.propositionKind)
    ? input.propositionKind
    : 'binary_close_higher'

  if (kind === 'binary_close_higher') {
    return { ok: false, error: 'price rounds are graded from the market feed, not operator evidence' }
  }

  const shaped = observationShapeForRound({
    propositionKind: kind,
    observationShape: input.observationShape,
  })
  if (!shaped.ok) return shaped
  const shape: ObservationShape | null = shaped.shape
  const occurrenceGiven = input.occurrence !== undefined && input.occurrence !== null && input.occurrence !== ''

  if (kind === 'binary_threshold') {
    if (occurrenceGiven) {
      return { ok: false, error: 'threshold rounds do not take an occurrence report' }
    }
    const line = parsePrintedNumber(input.subjectLabel ?? '')
    const printed = parsePrintedNumber(fact)
    if (line == null) return { ok: false, error: 'this round has no numeric threshold in subject_label' }
    if (printed == null) return { ok: false, error: 'observed_fact must contain the published number' }
    if (printed === line) {
      return { ok: false, error: 'printed value equals the threshold — no side to derive' }
    }
    return { ok: true, derived_side: printed > line ? 'above' : 'below' }
  }

  if (kind !== 'binary_subject_outcome') {
    return { ok: false, error: `unsupported proposition_kind '${String(input.propositionKind)}'` }
  }

  if (shape === 'occurrence') {
    if (!occurrenceGiven) {
      return {
        ok: false,
        error: 'occurrence rounds require occurred | did_not_occur — will not parse the observed fact',
      }
    }
    if (!isOccurrenceReport(input.occurrence)) {
      return {
        ok: false,
        error: 'occurrence must be occurred or did_not_occur — not a side token',
      }
    }
    const report = input.occurrence as OccurrenceReport
    const [yes] = sidePairForKind(kind)
    return { ok: true, derived_side: report === 'occurred' ? yes : 'no' }
  }

  if (shape === 'name_match') {
    if (occurrenceGiven) {
      return { ok: false, error: 'name-match rounds do not take an occurrence report' }
    }
    const subject = normalizeObservedLabel(input.subjectLabel ?? '')
    if (!subject) return { ok: false, error: 'this round has no subject_label to compare the fact against' }
    const observed = normalizeObservedLabel(fact)
    if (!observed) return { ok: false, error: 'observed_fact has no comparable text' }
    const [yes] = sidePairForKind(kind)
    return { ok: true, derived_side: observed === subject ? yes : 'no' }
  }

  return { ok: false, error: 'this subject-outcome round has no observation_shape — will not guess' }
}

/** actual_outcome in the round's own vocabulary — never price-close wording. */
export function formatOperatorOutcome(derivedSide: AnswerSide, observedFact: string): string {
  const fact = observedFact.trim().replace(/\s+/g, ' ')
  return `${derivedSide} (observed ${fact})`
}
