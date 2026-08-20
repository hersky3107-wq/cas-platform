/**
 * Cron sweeper. Picks up sessions whose worker died — the phone locked, the
 * lambda was recycled, the chunk threw — and advances them one chunk each.
 *
 * A session qualifies when it is non-terminal, its heartbeat is older than
 * ORACLE_STALE_HEARTBEAT_SECONDS, and its lease is free or expired. The
 * lease claim inside advance is what makes this safe to run concurrently
 * with a client that has come back online.
 */
import { advanceOracleSession, type AdvanceDeps, type AdvanceOutcome } from './advance'
import { ORACLE_STALE_HEARTBEAT_SECONDS, ORACLE_SWEEP_BATCH_SIZE } from './conventions'

export type SweepSummary = {
  candidates: number
  claimed: number
  skipped: number
  results: Array<{ sessionId: string; status: string | null; nextAction: string | null; claimed: boolean }>
}

export async function sweepOracleSessions(
  deps: AdvanceDeps,
  limit = ORACLE_SWEEP_BATCH_SIZE,
): Promise<SweepSummary> {
  const now = (deps.now ?? (() => new Date()))()
  const staleBefore = new Date(now.getTime() - ORACLE_STALE_HEARTBEAT_SECONDS * 1_000)

  const candidates = await deps.store.listStaleSessions(limit, staleBefore.toISOString(), now.toISOString())

  const results: SweepSummary['results'] = []
  let claimed = 0

  // Sequential on purpose: each advance schedules background work, and a
  // burst of 20 parallel claims would spike the AI-unit gauge for no gain.
  for (const session of candidates) {
    const outcome: AdvanceOutcome = await advanceOracleSession(session.id, deps)
    if (outcome.claimed) claimed += 1
    results.push({
      sessionId: session.id,
      status: outcome.status,
      nextAction: outcome.nextAction,
      claimed: outcome.claimed,
    })
  }

  return { candidates: candidates.length, claimed, skipped: candidates.length - claimed, results }
}
