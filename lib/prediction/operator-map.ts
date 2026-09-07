/**
 * Operator evidence → side token. Pure: no I/O.
 *
 * The operator types a published URL and the observed fact. This module maps
 * that fact onto the round's side pair. It never accepts a winner pick and
 * never returns "correct"/"incorrect".
 *
 *   binary_subject_outcome — normalized equality with subject_label
 *   binary_threshold       — numeric compare of the printed value vs the line
 *   binary_close_higher    — refused (price rounds use the feed, not this path)
 */

import { isPropositionKind, sidePairForKind, type AnswerSide } from '@/lib/league/answer-contract'

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
}): OperatorMapResult {
  const fact = input.observedFact.trim()
  if (!fact) return { ok: false, error: 'observed_fact is required' }

  const kind = isPropositionKind(input.propositionKind)
    ? input.propositionKind
    : 'binary_close_higher'

  if (kind === 'binary_close_higher') {
    return { ok: false, error: 'price rounds are graded from the market feed, not operator evidence' }
  }

  if (kind === 'binary_subject_outcome') {
    const subject = normalizeObservedLabel(input.subjectLabel ?? '')
    if (!subject) return { ok: false, error: 'this round has no subject_label to compare the fact against' }
    const observed = normalizeObservedLabel(fact)
    if (!observed) return { ok: false, error: 'observed_fact has no comparable text' }
    const [yes] = sidePairForKind(kind)
    return { ok: true, derived_side: observed === subject ? yes : 'no' }
  }

  if (kind === 'binary_threshold') {
    const line = parsePrintedNumber(input.subjectLabel ?? '')
    const printed = parsePrintedNumber(fact)
    if (line == null) return { ok: false, error: 'this round has no numeric threshold in subject_label' }
    if (printed == null) return { ok: false, error: 'observed_fact must contain the published number' }
    if (printed === line) {
      return { ok: false, error: 'printed value equals the threshold — no side to derive' }
    }
    return { ok: true, derived_side: printed > line ? 'above' : 'below' }
  }

  return { ok: false, error: `unsupported proposition_kind '${String(input.propositionKind)}'` }
}

/** actual_outcome in the round's own vocabulary — never price-close wording. */
export function formatOperatorOutcome(derivedSide: AnswerSide, observedFact: string): string {
  const fact = observedFact.trim().replace(/\s+/g, ' ')
  return `${derivedSide} (observed ${fact})`
}
