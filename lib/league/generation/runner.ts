/**
 * AI Prediction League — generation job runner. MIRRORS lib/oracle/runner:
 *
 *   - atomic lease claim via a conditional UPDATE on (attempt_count,
 *     lease_until) — `claimGenerationJobLease` is the oracle claim verbatim
 *   - 20s heartbeats while model calls are in flight
 *   - per-unit immediate persistence: every model's row is upserted by the
 *     orchestrator the moment it answers, so a resumed worker never redoes
 *     finished work (resume state = which model_ids have rows)
 *   - per-unit timeouts fail the MODEL (null-direction 결번 row), never the job
 *   - an attempt_count cap that fails-and-refunds a poisoned job
 *
 * DELIBERATE DEVIATIONS (each reported):
 *   1. One advance CHAINS stages while inside its wall-clock budget, where
 *      oracle runs exactly one chunk per advance. League units are 3-10×
 *      slower (60-240s model timeouts vs 25s), and a strict one-stage-per-tick
 *      run would add ~4 idle minutes of cron gaps to every healthy round.
 *      The budget + heartbeats keep a chained advance exactly as claimable
 *      after a crash as a single-chunk one.
 *   2. No 'partial' terminal status: league semantics already render a model
 *      that timed out as a 결번 row and the round completes 'done' around it.
 *   3. Refund on terminal failure refunds EVERY charged-unrefunded purchase
 *      row on the round (each exactly once via a conditional UPDATE), not
 *      just the job's own payer — under paid-view pricing, viewers who
 *      attached to a round that never materialized paid for nothing too.
 *
 * Dependency-injected so unit tests drive it with fakes (no supabase);
 * `live-deps.ts` binds the real store/orchestrator/credits.
 */
import type { LeagueGenerationJob } from './job-store'
import {
  LEAGUE_JOB_HEARTBEAT_SECONDS,
  LEAGUE_JOB_LEASE_SECONDS,
  LEAGUE_JOB_MAX_ATTEMPTS,
  LEAGUE_JOB_MAX_RUNNING,
  LEAGUE_JOB_STALE_HEARTBEAT_SECONDS,
  LEAGUE_JOB_SWEEP_BATCH_SIZE,
  LEAGUE_JOB_TICK_BUDGET_MS,
  nextGenerationStage,
  tierForStage,
} from './policy'

export type RunnerJobPatch = Partial<
  Pick<
    LeagueGenerationJob,
    'status' | 'stage' | 'lease_until' | 'last_heartbeat_at' | 'attempt_count' | 'last_error' | 'completed_at'
  >
>

export type ModelRowFact = { model_id: string; predicted_direction: string | null; predicted_at: string }

export type LeagueRunnerStore = {
  getJob(jobId: string): Promise<LeagueGenerationJob | null>
  claimLease(jobId: string, leaseUntil: string, nowIso: string): Promise<LeagueGenerationJob | null>
  updateJob(jobId: string, patch: RunnerJobPatch): Promise<void>
  touchHeartbeat(jobId: string, nowIso: string): Promise<void>
  listRoundModelRows(roundId: string): Promise<ModelRowFact[]>
  listChargedUnrefundedForRound(roundId: string): Promise<LeagueGenerationJob[]>
  markJobRefundedOnce(jobRowId: string): Promise<LeagueGenerationJob | null>
  listClaimableJobs(limit: number, staleBeforeIso: string, nowIso: string): Promise<LeagueGenerationJob[]>
  countRunningJobs(nowIso: string): Promise<number>
}

export type GenerateTierChunk = (args: {
  roundId: string
  tier: 'premier' | 'challenger' | 'world' | 'scout'
  excludeModelIds: string[]
  deadlineAtMs: number
  onModelResult: (modelId: string) => void
}) => Promise<void>

export type LeagueRunnerDeps = {
  store: LeagueRunnerStore
  /** One tier fan-out against an existing round — live wiring binds generatePredictions. */
  generate: GenerateTierChunk
  /** Recompute + persist final consensus from every model row (finalize stage). */
  finalizeConsensus: (roundId: string) => Promise<void>
  /** Money back — live wiring binds addCreditsBalance (the deep-analysis refund primitive). */
  refundCredits: (userId: string, amount: number) => Promise<void>
  /** Full model_id list per tier (roster order). */
  tierModelIds: (tier: 'premier' | 'challenger' | 'world' | 'scout') => string[]
  /**
   * Close-higher jobs must already have a persisted anchor. 'fail' trips
   * the same terminal-refund path as the attempt cap — never fan out 41
   * models on an empty packet. Tests default this to 'proceed'.
   */
  priceAnchorGate: (roundId: string) => Promise<'proceed' | 'fail'>
  /** Routes pass `after()`; tests pass a collector so the chunk can be awaited. */
  schedule: (task: () => Promise<void>) => void
  now?: () => Date
  /** Test override for the stage-chaining wall clock. */
  tickBudgetMs?: number
}

export type AdvanceJobOutcome = {
  found: boolean
  jobId: string
  status: string | null
  stage: string | null
  /** False when terminal or another worker holds the lease. */
  claimed: boolean
}

/**
 * Which models a job may still run. Two rules, per the retry spec:
 *  - a row with a real direction is FINISHED — never redone by anyone;
 *  - a null-direction row (timeout/error/abstain 결번) is FINAL for the job
 *    that wrote it, but a LATER job (a paid retry after failure) gives those
 *    models one more chance: eligible again when the row's last attempt
 *    predates this job's creation.
 */
export function excludedModelIds(rows: readonly ModelRowFact[], jobCreatedAt: string): Set<string> {
  const excluded = new Set<string>()
  for (const row of rows) {
    if (row.predicted_direction !== null) {
      excluded.add(row.model_id)
    } else if (row.predicted_at >= jobCreatedAt) {
      excluded.add(row.model_id)
    }
  }
  return excluded
}

/**
 * Claims the lease and hands the chunk to the background. Returns as soon as
 * the claim resolves; the caller must not await the chunk. (Oracle's
 * `advanceOracleSession`, one-to-one.)
 */
export async function advanceLeagueGenerationJob(
  jobId: string,
  deps: LeagueRunnerDeps
): Promise<AdvanceJobOutcome> {
  const now = deps.now ?? (() => new Date())
  const current = await deps.store.getJob(jobId)
  if (!current) return { found: false, jobId, status: null, stage: null, claimed: false }
  if (current.status === 'done' || current.status === 'failed') {
    return { found: true, jobId, status: current.status, stage: current.stage, claimed: false }
  }

  const at = now()
  const leaseUntil = new Date(at.getTime() + LEAGUE_JOB_LEASE_SECONDS * 1_000).toISOString()
  const claimed = await deps.store.claimLease(jobId, leaseUntil, at.toISOString())
  if (!claimed) {
    return { found: true, jobId, status: current.status, stage: current.stage, claimed: false }
  }

  deps.schedule(() => runLeagueGenerationChunk(claimed, deps))
  return { found: true, jobId, status: claimed.status, stage: claimed.stage, claimed: true }
}

/**
 * One claimed advance: run stages until the tick budget is spent, the job
 * finishes, or a stage cannot complete. Always releases the lease, even on
 * an unexpected throw (lease dropped WITHOUT a heartbeat refresh, so the
 * sweeper can reclaim promptly — oracle's exact failure posture).
 */
export async function runLeagueGenerationChunk(job: LeagueGenerationJob, deps: LeagueRunnerDeps): Promise<void> {
  const now = deps.now ?? (() => new Date())
  const startedAtMs = Date.now()
  const tickBudgetMs = deps.tickBudgetMs ?? LEAGUE_JOB_TICK_BUDGET_MS
  const deadlineAtMs = startedAtMs + tickBudgetMs

  if (job.attempt_count > LEAGUE_JOB_MAX_ATTEMPTS) {
    await closeOutExhaustedJob(job, deps, now)
    return
  }

  const anchorGate = await deps.priceAnchorGate(job.round_id)
  if (anchorGate === 'fail') {
    await failLeagueGenerationJob(job, deps, now, 'missing_anchor: price packet never persisted')
    return
  }

  // Renew lease + heartbeat every 20s while model calls run, so a slow chunk
  // is never mistaken for dead (oracle's runParallelWithLeaseHeartbeat).
  const heartbeat = setInterval(() => {
    const at = now()
    void deps.store.updateJob(job.id, {
      last_heartbeat_at: at.toISOString(),
      lease_until: new Date(at.getTime() + LEAGUE_JOB_LEASE_SECONDS * 1_000).toISOString(),
    })
  }, LEAGUE_JOB_HEARTBEAT_SECONDS * 1_000)

  let produced = 0

  const endChunk = async (patch: RunnerJobPatch): Promise<void> => {
    await deps.store.updateJob(job.id, {
      lease_until: null,
      last_heartbeat_at: now().toISOString(),
      // Progress resets the attempt budget; a stalled job keeps its count.
      attempt_count: produced > 0 ? 0 : job.attempt_count,
      ...patch,
    })
  }

  try {
    const rows = await deps.store.listRoundModelRows(job.round_id)
    const written = excludedModelIds(rows, job.created_at)

    let stage = job.stage
    for (;;) {
      if (stage === 'finalize') {
        await deps.finalizeConsensus(job.round_id)
        await endChunk({
          status: 'done',
          stage: 'done',
          completed_at: now().toISOString(),
          attempt_count: 0,
          last_error: null,
        })
        return
      }

      const tier = tierForStage(stage)
      if (!tier) {
        // Unknown stage value (stage column is deliberately CHECK-less) —
        // jump to finalize rather than spinning.
        stage = 'finalize'
        await deps.store.updateJob(job.id, { stage })
        continue
      }

      const tierIds = deps.tierModelIds(tier)
      const outstanding = tierIds.filter((id) => !written.has(id))

      if (outstanding.length > 0) {
        await deps.generate({
          roundId: job.round_id,
          tier,
          excludeModelIds: [...written],
          deadlineAtMs,
          onModelResult: (modelId) => {
            written.add(modelId)
            produced += 1
            // Heartbeat per unit, so the sweeper can tell alive from stuck.
            void deps.store.touchHeartbeat(job.id, now().toISOString())
          },
        })
      }

      const remaining = tierIds.filter((id) => !written.has(id))
      if (remaining.length > 0) {
        // Budget gate stopped launches (or a crash left gaps): persist the
        // stage as-is and let the next tick resume exactly here.
        await endChunk({ stage })
        return
      }

      const next = nextGenerationStage(stage)
      if (!next) {
        stage = 'finalize'
      } else {
        stage = next
      }
      await deps.store.updateJob(job.id, { stage, last_heartbeat_at: now().toISOString() })

      if (Date.now() - startedAtMs > tickBudgetMs) {
        await endChunk({ stage })
        return
      }
    }
  } catch (e: unknown) {
    // Drop the lease without refreshing the heartbeat, so the sweeper picks
    // this up on its next pass rather than a minute later.
    const message = e instanceof Error ? e.message : 'league generation chunk threw'
    await deps.store.updateJob(job.id, { lease_until: null, last_error: message.slice(0, 500) })
  } finally {
    clearInterval(heartbeat)
    // Per-tick wall time + volume, for measuring chunk sizing in production.
    console.log(
      `[league-generate] job=${job.id} round=${job.round_id} stage_in=${job.stage} ` +
        `models_produced=${produced} tick_ms=${Date.now() - startedAtMs}`
    )
  }
}

/**
 * Out of attempts: the job is failed and EVERY purchase row on the round that
 * still holds money is refunded — exactly once each, enforced by the
 * conditional flip in `markJobRefundedOnce`. Uses the deep-analysis refund
 * primitive (credits added back via the same `addCreditsBalance` the
 * deep-run `refundDeep` path calls), with the same skip rules: nothing moves
 * for `deduct_skipped` (admin) or zero-cost rows.
 */
export async function failLeagueGenerationJob(
  job: LeagueGenerationJob,
  deps: LeagueRunnerDeps,
  now: () => Date,
  lastError: string
): Promise<void> {
  await refundLeagueRoundPurchases(job.round_id, deps)
  await deps.store.updateJob(job.id, {
    status: 'failed',
    lease_until: null,
    last_heartbeat_at: now().toISOString(),
    completed_at: now().toISOString(),
    last_error: lastError.slice(0, 500),
  })
}

export async function closeOutExhaustedJob(
  job: LeagueGenerationJob,
  deps: LeagueRunnerDeps,
  now: () => Date
): Promise<void> {
  await failLeagueGenerationJob(
    job,
    deps,
    now,
    job.last_error ?? `attempt cap reached (${LEAGUE_JOB_MAX_ATTEMPTS})`
  )
}

/** Refund every charged-unrefunded purchase on the round, each exactly once. */
export async function refundLeagueRoundPurchases(roundId: string, deps: LeagueRunnerDeps): Promise<number> {
  const rows = await deps.store.listChargedUnrefundedForRound(roundId)
  let refunded = 0
  for (const row of rows) {
    const won = await deps.store.markJobRefundedOnce(row.id)
    if (!won) continue // another worker already refunded this row
    refunded += 1
    if (!row.deduct_skipped && row.charged_cost > 0 && row.user_id) {
      await deps.refundCredits(row.user_id, row.charged_cost)
    }
  }
  return refunded
}

export type LeagueSweepSummary = {
  candidates: number
  claimed: number
  runningBefore: number
  results: Array<{ jobId: string; status: string | null; stage: string | null; claimed: boolean }>
}

/**
 * Cron sweep: claim queued / stale jobs up to the GLOBAL running cap
 * (LEAGUE_JOB_MAX_RUNNING). Sequential on purpose, same as the oracle sweep —
 * each claim schedules background fan-out, and parallel claims would spike
 * provider concurrency for no gain.
 */
export async function sweepLeagueGenerationJobs(
  deps: LeagueRunnerDeps,
  limit = LEAGUE_JOB_SWEEP_BATCH_SIZE
): Promise<LeagueSweepSummary> {
  const now = (deps.now ?? (() => new Date()))()
  const staleBefore = new Date(now.getTime() - LEAGUE_JOB_STALE_HEARTBEAT_SECONDS * 1_000)

  const runningBefore = await deps.store.countRunningJobs(now.toISOString())
  const budget = Math.max(0, LEAGUE_JOB_MAX_RUNNING - runningBefore)
  if (budget === 0) {
    return { candidates: 0, claimed: 0, runningBefore, results: [] }
  }

  const candidates = await deps.store.listClaimableJobs(
    Math.min(limit, budget),
    staleBefore.toISOString(),
    now.toISOString()
  )

  const results: LeagueSweepSummary['results'] = []
  let claimed = 0
  for (const job of candidates) {
    const outcome = await advanceLeagueGenerationJob(job.id, deps)
    if (outcome.claimed) claimed += 1
    results.push({ jobId: job.id, status: outcome.status, stage: outcome.stage, claimed: outcome.claimed })
  }

  return { candidates: candidates.length, claimed, runningBefore, results }
}
