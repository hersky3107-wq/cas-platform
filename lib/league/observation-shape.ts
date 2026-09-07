/**
 * How an operator-manual round turns an observation into a side.
 *
 * `binary_subject_outcome` covers TWO observation shapes. Treating them as
 * one (name-equality with subject_label) silently inverts tech grades.
 *
 *   name_match  — the observed fact names a winner / electee / honoree;
 *                 compare to subject_label (sports, elections, awards).
 *   occurrence  — the observed fact is evidence that the stated thing
 *                 happened or did not; the operator reports that as a
 *                 structured world-fact, never by parsing prose.
 *
 * AUTHOR: the CategoryAdapter declares the shape.
 * GRADE-TIME SOURCE OF TRUTH: the persisted column on prediction_rounds.
 * The adapter is not re-consulted at grade time — a later adapter edit
 * must not reinterpret a historical round. Missing column on a
 * subject-outcome row is the legacy sports default (name_match).
 */

export const OBSERVATION_SHAPES = ['name_match', 'occurrence'] as const
export type ObservationShape = (typeof OBSERVATION_SHAPES)[number]

/** Structured world-fact for the occurrence shape. Not a side token. */
export const OCCURRENCE_REPORTS = ['occurred', 'did_not_occur'] as const
export type OccurrenceReport = (typeof OCCURRENCE_REPORTS)[number]

export function isObservationShape(raw: unknown): raw is ObservationShape {
  return typeof raw === 'string' && (OBSERVATION_SHAPES as readonly string[]).includes(raw)
}

export function isOccurrenceReport(raw: unknown): raw is OccurrenceReport {
  return typeof raw === 'string' && (OCCURRENCE_REPORTS as readonly string[]).includes(raw)
}

/**
 * Grade-time shape for a loaded round. Unknown persisted values refuse
 * upstream (caller must not guess). Null column + subject_outcome →
 * name_match (legacy sports rows written before this column existed).
 */
export function observationShapeForRound(input: {
  propositionKind: string | null
  observationShape: unknown
}): { ok: true; shape: ObservationShape | null } | { ok: false; error: string } {
  if (input.observationShape == null || input.observationShape === '') {
    if (input.propositionKind === 'binary_subject_outcome') {
      return { ok: true, shape: 'name_match' }
    }
    return { ok: true, shape: null }
  }
  if (!isObservationShape(input.observationShape)) {
    return {
      ok: false,
      error: `unknown observation_shape '${String(input.observationShape)}' — will not guess`,
    }
  }
  return { ok: true, shape: input.observationShape }
}
