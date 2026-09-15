/**
 * Hub generation progress: "모델 응답 수집 중 · N / rosterSize".
 *
 * Denominator is the active roster seat count for this run's tiers
 * (`getRoster(tiers).length`), never a hardcoded 41.
 * Numerator is seats *resolved* — a `model_predictions` row exists for that
 * roster `model_id`, including 결번 / no-opinion null rows that never become
 * tiles. `complete` is every active seat rendered or definitively dropped.
 */

export type RosterGenerationProgress = {
  rosterSize: number
  answered: number
  complete: boolean
}

export function rosterGenerationProgress(
  rosterModelIds: readonly string[],
  writtenModelIds: readonly string[]
): RosterGenerationProgress {
  const roster = new Set(rosterModelIds)
  const rosterSize = roster.size
  const resolved = new Set<string>()
  for (const id of writtenModelIds) {
    if (roster.has(id)) resolved.add(id)
  }
  const answered = resolved.size
  return {
    rosterSize,
    answered,
    complete: rosterSize > 0 && answered >= rosterSize,
  }
}

/** Roster seats whose prediction row is a definitive drop (null direction). */
export function droppedRosterModelIds(
  rosterModelIds: readonly string[],
  rows: readonly { model_id: string; predicted_direction: string | null }[]
): string[] {
  const roster = new Set(rosterModelIds)
  const out: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (row.predicted_direction !== null) continue
    if (!roster.has(row.model_id) || seen.has(row.model_id)) continue
    seen.add(row.model_id)
    out.push(row.model_id)
  }
  return out
}

/**
 * Display gate for the locked consensus conclusion.
 *
 * `generation.complete` is the seat-resolution flag (every active seat
 * rendered or dropped). While that is false, the hero must not present a
 * verdict computed from a partial set. Static cards (no generation job)
 * reveal the conclusion.
 */
export function revealConsensusConclusion(
  generationComplete: boolean | null | undefined,
  generating: boolean,
): boolean {
  if (generationComplete === true) return true
  if (generationComplete === false) return false
  return !generating
}

