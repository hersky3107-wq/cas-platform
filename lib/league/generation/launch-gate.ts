/**
 * Wall-clock launch gate for `generatePredictions` workers.
 *
 * A seat whose timeout cannot finish by `deadlineAtMs` is DEFERRED: the
 * cursor advances past it so later, shorter seats can still launch in this
 * chunk, but the seat is not claimed (no model call, no row). Resume state
 * is "has a row" — a deferred seat is therefore picked up on the next tick
 * via `excludeModelIds`, never silently dropped.
 *
 * Seats whose timeout equals the full tick budget cannot pass
 * `now + timeout <= deadline` after any overhead. A FRESH chunk (still near
 * tick start, nothing launched yet) therefore still claims such a seat —
 * a dedicated solo launch — so it is never permanently deferrable.
 *
 * Peek → check → claim is synchronous (no await). Parallel workers share one
 * `cursor` and cannot double-claim an index.
 */

export type LaunchGateEntry = { timeoutMs?: number }

export type LaunchCursor = { nextIndex: number }

/** Shared across workers: how many seats this generate() invocation claimed. */
export type LaunchChunkState = { launched: number }

/**
 * Packet/DB overhead at the start of a tick (live leftover-deepseek chunks
 * measured ~2s). Solo-launch a timeout<=budget seat only while elapsed is
 * within this window, so a chained later stage with ~90s remaining cannot
 * force a 240s call into a short remainder.
 */
export const LAUNCH_GATE_FRESH_CHUNK_MS = 30_000

export type LaunchGateOpts = {
  nowMs: number
  deadlineAtMs?: number
  defaultTimeoutMs: number
  /** Full tick budget (deadline − chunk start). Required for the solo/fresh rule. */
  tickBudgetMs?: number
  launchedThisChunk?: LaunchChunkState
}

export function entryTimeoutMs(entry: LaunchGateEntry, defaultTimeoutMs: number): number {
  return entry.timeoutMs && entry.timeoutMs > 0 ? entry.timeoutMs : defaultTimeoutMs
}

/**
 * Whether this seat may launch now. Remaining-time fit always wins.
 * Otherwise a leftover seat that fits a dedicated full tick may launch once
 * at the start of a fresh chunk (nothing launched yet, elapsed ≤ slack).
 */
export function seatCanLaunch(entryTimeoutMs: number, opts: LaunchGateOpts): boolean {
  if (opts.deadlineAtMs === undefined) return true
  if (opts.nowMs + entryTimeoutMs <= opts.deadlineAtMs) return true

  const tickBudgetMs = opts.tickBudgetMs
  const launched = opts.launchedThisChunk?.launched ?? 0
  if (
    tickBudgetMs !== undefined &&
    tickBudgetMs > 0 &&
    launched === 0 &&
    entryTimeoutMs <= tickBudgetMs
  ) {
    const remaining = opts.deadlineAtMs - opts.nowMs
    const elapsed = tickBudgetMs - remaining
    if (elapsed >= 0 && elapsed <= LAUNCH_GATE_FRESH_CHUNK_MS) return true
  }
  return false
}

/**
 * Claim the next roster index that can still launch. Unlaunchable seats
 * are skipped (deferred), not treated as end-of-roster. Returns `null`
 * when the roster is exhausted — including when only deferred seats remain
 * (those stay unclaimed for a later tick).
 */
export function claimNextLaunchableIndex(
  roster: readonly LaunchGateEntry[],
  cursor: LaunchCursor,
  opts: LaunchGateOpts
): number | null {
  while (cursor.nextIndex < roster.length) {
    const i = cursor.nextIndex
    const entry = roster[i]!
    const timeoutMs = entryTimeoutMs(entry, opts.defaultTimeoutMs)
    if (!seatCanLaunch(timeoutMs, opts)) {
      cursor.nextIndex = i + 1
      continue
    }
    cursor.nextIndex = i + 1
    if (opts.launchedThisChunk) opts.launchedThisChunk.launched += 1
    return i
  }
  return null
}
