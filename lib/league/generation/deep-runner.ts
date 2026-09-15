/**
 * Deep-open / deep-debate runner. REUSES the generation/oracle lease pattern:
 *   - atomic claim on (attempt_count, lease_until)
 *   - 20s heartbeats
 *   - attempt cap that fail-and-refunds via markRefundedOnce + refundDeep
 *
 * Deviations (reported):
 *   1. One hop per advance (not stage-chaining). A deep hop is already 78–93s;
 *      chaining four would blow the 300s tick budget and the 300s ceiling.
 *      Oracle also runs one chunk per advance — this matches oracle more
 *      closely than generation does.
 *   2. Own running cap (LEAGUE_DEEP_MAX_RUNNING=2), not the generation 3.
 *      Three deep jobs would stall every paid round for ~6 minutes.
 *   3. Claim also requires busy_until free, so a mid-flight HTTP hop from
 *      before this shipped is never stolen.
 *   4. Terminal status is 'error' (deep CHECK), not generation's 'failed'.
 */
import type { DeepRunRow } from '../deep-store'
import { isUnseededState } from '../deep-run-policy'
import {
  LEAGUE_DEEP_MAX_RUNNING,
  LEAGUE_JOB_HEARTBEAT_SECONDS,
  LEAGUE_JOB_LEASE_SECONDS,
  LEAGUE_JOB_MAX_ATTEMPTS,
  LEAGUE_JOB_STALE_HEARTBEAT_SECONDS,
  LEAGUE_JOB_SWEEP_BATCH_SIZE,
} from './policy'

export type DeepRunnerPatch = Partial<
  Pick<DeepRunRow, 'status' | 'stage' | 'lease_until' | 'last_heartbeat_at' | 'attempt_count' | 'last_error' | 'refunded'>
>

export type DeepRunnerStore = {
  getRun(id: string): Promise<DeepRunRow | null>
  claimLease(id: string, leaseUntil: string, nowIso: string): Promise<DeepRunRow | null>
  updateRun(id: string, patch: DeepRunnerPatch): Promise<void>
  touchHeartbeat(id: string, nowIso: string): Promise<void>
  markRefundedOnce(id: string): Promise<DeepRunRow | null>
  listClaimable(limit: number, staleBeforeIso: string, nowIso: string): Promise<DeepRunRow[]>
  countRunning(nowIso: string): Promise<number>
}

export type DeepSeedFn = (row: DeepRunRow) => Promise<
  { ok: true; row: DeepRunRow } | { ok: false; retry: true } | { ok: false; giveUp: true; row: DeepRunRow }
>

export type DeepHopFn = (row: DeepRunRow) => Promise<
  { done: false; stage: string } | { done: true; ok: true } | { done: true; ok: false; error: string }
>

export type DeepRunnerDeps = {
  store: DeepRunnerStore
  seed: DeepSeedFn
  advanceHop: DeepHopFn
  refundCredits: (userId: string, amount: number, deductSkipped: boolean) => Promise<void>
  schedule: (task: () => Promise<void>) => void
  now?: () => Date
  maxRunning?: number
}

export type AdvanceDeepOutcome = {
  found: boolean
  jobId: string
  status: string | null
  stage: string | null
  claimed: boolean
}

export async function advanceDeepRun(jobId: string, deps: DeepRunnerDeps): Promise<AdvanceDeepOutcome> {
  const now = deps.now ?? (() => new Date())
  const current = await deps.store.getRun(jobId)
  if (!current) return { found: false, jobId, status: null, stage: null, claimed: false }
  if (current.status === 'done' || current.status === 'error') {
    return { found: true, jobId, status: current.status, stage: current.stage, claimed: false }
  }

  const at = now()
  const running = await deps.store.countRunning(at.toISOString())
  const cap = deps.maxRunning ?? LEAGUE_DEEP_MAX_RUNNING
  if (running >= cap) {
    return { found: true, jobId, status: current.status, stage: current.stage, claimed: false }
  }

  const leaseUntil = new Date(at.getTime() + LEAGUE_JOB_LEASE_SECONDS * 1_000).toISOString()
  const claimed = await deps.store.claimLease(jobId, leaseUntil, at.toISOString())
  if (!claimed) {
    return { found: true, jobId, status: current.status, stage: current.stage, claimed: false }
  }

  deps.schedule(() => runDeepChunk(claimed, deps))
  return { found: true, jobId, status: claimed.status, stage: claimed.stage, claimed: true }
}

export async function runDeepChunk(row: DeepRunRow, deps: DeepRunnerDeps): Promise<void> {
  const now = deps.now ?? (() => new Date())

  if (row.attempt_count > LEAGUE_JOB_MAX_ATTEMPTS) {
    await closeOutExhaustedDeepRun(row, deps, now)
    return
  }

  const heartbeat = setInterval(() => {
    const at = now()
    void deps.store.updateRun(row.id, {
      last_heartbeat_at: at.toISOString(),
      lease_until: new Date(at.getTime() + LEAGUE_JOB_LEASE_SECONDS * 1_000).toISOString(),
    })
  }, LEAGUE_JOB_HEARTBEAT_SECONDS * 1_000)

  let produced = false

  try {
    if (isUnseededState(row.state)) {
      const seeded = await deps.seed(row)
      if (seeded.ok) {
        produced = true
        const hop = await deps.advanceHop(seeded.row)
        produced = true
        await finishHop(row, hop, deps, now)
        return
      }
      if ('giveUp' in seeded && seeded.giveUp) {
        await refundDeepRunOnce(seeded.row, deps)
        await deps.store.updateRun(row.id, {
          status: 'error',
          stage: 'seed_failed',
          lease_until: null,
          last_heartbeat_at: now().toISOString(),
          last_error: 'seed failed after max attempts',
        })
        return
      }
      // Free the lease and clear the heartbeat so the next cron tick can
      // reclaim immediately — same "queued = null heartbeat" convention
      // as generation jobs. Stamping now() here would add a 60s stale wait.
      await deps.store.updateRun(row.id, {
        lease_until: null,
        last_heartbeat_at: null,
      })
      return
    }

    const hop = await deps.advanceHop(row)
    produced = true
    await finishHop(row, hop, deps, now)
  } catch (e: unknown) {
    // Drop the lease WITHOUT refreshing the heartbeat (generation's throw
    // posture) so the sweeper can reclaim on the next pass.
    const message = e instanceof Error ? e.message : 'deep chunk threw'
    await deps.store.updateRun(row.id, { lease_until: null, last_error: message.slice(0, 500) })
  } finally {
    clearInterval(heartbeat)
    if (produced) {
      // attempt_count reset is applied in finishHop / end-of-hop updates
    }
    console.log(`[league-deep] run=${row.id} product=${row.product} stage_in=${row.stage} produced=${produced}`)
  }
}

async function finishHop(
  row: DeepRunRow,
  hop: Awaited<ReturnType<DeepHopFn>>,
  deps: DeepRunnerDeps,
  now: () => Date
): Promise<void> {
  if (hop.done && hop.ok === false) {
    await refundDeepRunOnce(row, deps)
    await deps.store.updateRun(row.id, {
      status: 'error',
      lease_until: null,
      last_heartbeat_at: now().toISOString(),
      attempt_count: 0,
      last_error: hop.error.slice(0, 500),
    })
    return
  }
  if (hop.done && hop.ok) {
    await deps.store.updateRun(row.id, {
      lease_until: null,
      last_heartbeat_at: now().toISOString(),
      attempt_count: 0,
      last_error: null,
    })
    return
  }
  // More hops remain. Null the heartbeat so the next sweep (or the
  // same-tick enqueue) sees a queued row, not a "still live" worker.
  await deps.store.updateRun(row.id, {
    lease_until: null,
    last_heartbeat_at: null,
    attempt_count: 0,
    last_error: null,
  })
}

export async function closeOutExhaustedDeepRun(
  row: DeepRunRow,
  deps: DeepRunnerDeps,
  now: () => Date
): Promise<void> {
  await refundDeepRunOnce(row, deps)
  await deps.store.updateRun(row.id, {
    status: 'error',
    lease_until: null,
    last_heartbeat_at: now().toISOString(),
    last_error: row.last_error ?? `attempt cap reached (${LEAGUE_JOB_MAX_ATTEMPTS})`,
  })
}

/** Refund this purchase exactly once. Uses the same flip the generation runner uses. */
export async function refundDeepRunOnce(row: DeepRunRow, deps: DeepRunnerDeps): Promise<boolean> {
  const won = await deps.store.markRefundedOnce(row.id)
  if (!won) return false
  if (!row.deduct_skipped && row.charged_cost > 0 && row.user_id) {
    await deps.refundCredits(row.user_id, row.charged_cost, row.deduct_skipped)
  }
  return true
}

export type DeepSweepSummary = {
  candidates: number
  claimed: number
  runningBefore: number
  results: Array<{ jobId: string; status: string | null; stage: string | null; claimed: boolean }>
}

export async function sweepLeagueDeepRuns(
  deps: DeepRunnerDeps,
  limit = LEAGUE_JOB_SWEEP_BATCH_SIZE
): Promise<DeepSweepSummary> {
  const now = (deps.now ?? (() => new Date()))()
  const staleBefore = new Date(now.getTime() - LEAGUE_JOB_STALE_HEARTBEAT_SECONDS * 1_000)
  const cap = deps.maxRunning ?? LEAGUE_DEEP_MAX_RUNNING

  const runningBefore = await deps.store.countRunning(now.toISOString())
  const budget = Math.max(0, cap - runningBefore)
  if (budget === 0) {
    return { candidates: 0, claimed: 0, runningBefore, results: [] }
  }

  const candidates = await deps.store.listClaimable(
    Math.min(limit, budget),
    staleBefore.toISOString(),
    now.toISOString()
  )

  const results: DeepSweepSummary['results'] = []
  let claimed = 0
  for (const job of candidates) {
    const outcome = await advanceDeepRun(job.id, deps)
    if (outcome.claimed) claimed += 1
    results.push({ jobId: job.id, status: outcome.status, stage: outcome.stage, claimed: outcome.claimed })
  }

  return { candidates: candidates.length, claimed, runningBefore, results }
}
