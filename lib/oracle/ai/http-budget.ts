/** Shared per-unit HTTP budget for oracle layer-1 (adapter + platform retry). */
export type Layer1HttpBudget = {
  remaining: number
  /** Total HTTP fetches actually made for this unit. */
  attempts: number
  /** Wall time of the most recent HTTP fetch only (ms). */
  finalAttemptMs: number | null
}

export function createLayer1HttpBudget(remaining: number): Layer1HttpBudget {
  return { remaining, attempts: 0, finalAttemptMs: null }
}

export function recordHttpAttemptStart(budget: Layer1HttpBudget | undefined): number | null {
  if (!budget) return null
  if (budget.remaining <= 0) return null
  budget.remaining -= 1
  return Date.now()
}

export function recordHttpAttemptEnd(
  budget: Layer1HttpBudget | undefined,
  attemptStartMs: number | null,
): void {
  if (!budget || attemptStartMs == null) return
  budget.attempts += 1
  budget.finalAttemptMs = Date.now() - attemptStartMs
}
