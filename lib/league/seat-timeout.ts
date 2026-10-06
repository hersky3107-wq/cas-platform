/**
 * A timeout retry needs another full seat timeout still inside the tick.
 * No deadline (manual runs) always allows the one retry.
 */
export function timeoutRetryFits(remainingMs: number | null | undefined, timeoutMs: number): boolean {
  if (remainingMs == null) return true
  if (!Number.isFinite(remainingMs) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return false
  return remainingMs >= timeoutMs
}
