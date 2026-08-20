/**
 * Ceiling on AI units in flight.
 *
 * PROCESS-LOCAL by design: on a multi-instance deploy each instance enforces
 * its own cap, so the effective global limit is (instances × the constant).
 * A truly global cap needs a counter table and a round trip per unit; that
 * cost is not worth paying while the provider is stubbed. The behaviour that
 * matters is already here — over the cap a chunk does no work, leaves
 * next_action untouched, and the sweeper retries it a minute later.
 */
import { ORACLE_MAX_CONCURRENT_AI_UNITS } from './conventions'

let inFlight = 0

/** All-or-nothing: a chunk never runs half its units. */
export function tryAcquireAiSlots(count: number): boolean {
  if (count <= 0) return true
  if (inFlight + count > ORACLE_MAX_CONCURRENT_AI_UNITS) return false
  inFlight += count
  return true
}

export function releaseAiSlots(count: number): void {
  if (count <= 0) return
  inFlight = Math.max(0, inFlight - count)
}

export function inFlightAiUnits(): number {
  return inFlight
}

/** Test hook. Never call this from application code. */
export function resetAiSlots(): void {
  inFlight = 0
}
