/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * WHY THIS EXISTS: paid endpoints (league live generation, the governance deep
 * modes) each cost real credits AND real provider money per call. Credits are
 * the primary economic guard, but a user hammering an endpoint can still burn
 * their own balance (and our provider spend) far faster than any human intent
 * — and a bug in a client retry loop looks exactly like abuse. This is the
 * cheap first line of defense in front of the charge.
 *
 * HONEST LIMITATIONS (read before relying on this for anything stronger):
 *  - PER-PROCESS. State lives in this module's memory, so on a serverless /
 *    multi-instance deploy each instance keeps its own counters and the
 *    effective limit is (limit x instances). This is deliberately accepted as
 *    "basic protection" — there is no Redis/Upstash in this project (verified:
 *    no rate-limit or Redis dependency exists), and adding one is a separate
 *    infrastructure decision.
 *  - NOT A SECURITY BOUNDARY. Auth, jurisdiction, and credit checks are the
 *    real enforcement; this only smooths burst traffic.
 *  - Memory is bounded by MAX_TRACKED_KEYS (oldest-touched keys are evicted),
 *    so a key-space flood cannot grow this map without limit.
 *
 * No `next/server` import on purpose: this stays a pure, unit-testable
 * function. Callers build their own 429 response (see
 * `lib/league/public-access.ts`'s `rateLimitedResponse`).
 */

export type RateLimitRule = {
  /** Max allowed hits per window. */
  limit: number
  windowMs: number
}

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterMs: number; remaining: 0 }

/** Beyond this many distinct keys, the least-recently-touched are dropped. */
const MAX_TRACKED_KEYS = 10_000

/** key -> hit timestamps (ms), oldest first, pruned to the current window on access. */
const hits = new Map<string, number[]>()

function prune(timestamps: number[], windowStart: number): number[] {
  // Timestamps are appended in order, so the first in-window index is a scan
  // from the front — cheap for the small per-key arrays these limits imply.
  let i = 0
  while (i < timestamps.length && timestamps[i]! <= windowStart) i += 1
  return i === 0 ? timestamps : timestamps.slice(i)
}

function evictIfNeeded(): void {
  if (hits.size <= MAX_TRACKED_KEYS) return
  // Map preserves insertion order and `touch` re-inserts, so the first keys
  // are the least recently touched.
  const overflow = hits.size - MAX_TRACKED_KEYS
  let dropped = 0
  for (const key of hits.keys()) {
    hits.delete(key)
    dropped += 1
    if (dropped >= overflow) break
  }
}

/**
 * Records a hit for `key` and reports whether it is allowed under `rule`.
 * A rejected call is NOT recorded (a blocked caller can't extend their own
 * penalty window by retrying).
 */
export function checkRateLimit(key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitResult {
  const windowStart = now - rule.windowMs
  const pruned = prune(hits.get(key) ?? [], windowStart)

  if (pruned.length >= rule.limit) {
    const oldest = pruned[0]!
    hits.set(key, pruned)
    return { ok: false, retryAfterMs: Math.max(0, oldest + rule.windowMs - now), remaining: 0 }
  }

  pruned.push(now)
  // Delete + set so this key moves to the end of the insertion order (LRU touch).
  hits.delete(key)
  hits.set(key, pruned)
  evictIfNeeded()

  return { ok: true, remaining: rule.limit - pruned.length }
}

/** Test-only helper: clears all counters so cases don't leak into each other. */
export function resetRateLimits(): void {
  hits.clear()
}
