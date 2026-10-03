import { describe, expect, it } from 'vitest'
import type { LeagueGenerationJob } from '../job-store'
import { LEAGUE_JOB_MAX_ATTEMPTS, LEAGUE_JOB_MAX_RUNNING } from '../policy'
import { generationClaimBudget, coalesceRoundPacketBuild } from '../parallel-policy'
import { createProviderCallGate } from '../provider-gate'
import { claimNextLaunchableIndex } from '../launch-gate'
import { binaryCallsFromModels, dualConsensus } from '@/lib/league/log-odds-consensus'
import { officialRowsForConsensus } from '@/lib/league/extra/seats'
import {
  advanceLeagueGenerationJob,
  excludedModelIds,
  runLeagueGenerationChunk,
  sweepLeagueGenerationJobs,
  type GenerateTierChunk,
  type LeagueRunnerDeps,
  type LeagueRunnerStore,
  type ModelRowFact,
} from '../runner'

/** Small fixed roster so tier math is easy to eyeball. */
const TIERS = {
  premier: ['p1', 'p2', 'p3'],
  challenger: ['c1', 'c2', 'c3'],
  world: ['w1', 'w2'],
  scout: ['s1', 's2'],
  extra: [] as string[],
} as const

function makeJob(over: Partial<LeagueGenerationJob> = {}): LeagueGenerationJob {
  return {
    id: over.id ?? 'job-1',
    round_id: over.round_id ?? 'round-1',
    user_id: 'user_id' in over ? (over.user_id ?? null) : 'user-1',
    status: over.status ?? 'queued',
    stage: over.stage ?? 'packet',
    locale: over.locale ?? 'ko',
    charged: over.charged ?? true,
    charged_cost: over.charged_cost ?? 30,
    deduct_skipped: over.deduct_skipped ?? false,
    refunded: over.refunded ?? false,
    attempt_count: over.attempt_count ?? 0,
    lease_until: over.lease_until ?? null,
    last_heartbeat_at: over.last_heartbeat_at ?? null,
    last_error: over.last_error ?? null,
    created_at: over.created_at ?? '2026-09-14T00:00:00.000Z',
    updated_at: over.updated_at ?? '2026-09-14T00:00:00.000Z',
    completed_at: over.completed_at ?? null,
  }
}

/**
 * In-memory store with the same CONDITIONAL semantics the SQL enforces:
 * claim only wins on an active job with a free lease (attempt_count bumps),
 * and markJobRefundedOnce only wins while charged && !refunded. Single-
 * threaded JS makes each fake call atomic, which is exactly the guarantee
 * the conditional UPDATEs give the real store.
 */
function makeStore(jobs: LeagueGenerationJob[], modelRows: ModelRowFact[] = []) {
  const byId = new Map(jobs.map((j) => [j.id, j]))
  const rows = [...modelRows]

  const store: LeagueRunnerStore = {
    async getJob(jobId) {
      const job = byId.get(jobId)
      return job ? { ...job } : null
    },
    async claimLease(jobId, leaseUntil, nowIso) {
      const job = byId.get(jobId)
      if (!job) return null
      if (job.status === 'done' || job.status === 'failed') return null
      if (job.lease_until !== null && job.lease_until >= nowIso) return null
      job.status = 'running'
      job.attempt_count += 1
      job.lease_until = leaseUntil
      job.last_heartbeat_at = nowIso
      return { ...job }
    },
    async updateJob(jobId, patch) {
      const job = byId.get(jobId)
      if (job) Object.assign(job, patch)
    },
    async touchHeartbeat(jobId, nowIso) {
      const job = byId.get(jobId)
      if (job) job.last_heartbeat_at = nowIso
    },
    async listRoundModelRows(roundId) {
      return rows.filter(() => roundId !== '').map((r) => ({ ...r }))
    },
    async listChargedUnrefundedForRound(roundId) {
      return [...byId.values()].filter((j) => j.round_id === roundId && j.charged && !j.refunded).map((j) => ({ ...j }))
    },
    async markJobRefundedOnce(jobRowId) {
      const job = byId.get(jobRowId)
      if (!job || !job.charged || job.refunded) return null
      job.refunded = true
      return { ...job }
    },
    async listClaimableJobs(limit, staleBeforeIso, nowIso) {
      return [...byId.values()]
        .filter((j) => j.status === 'queued' || j.status === 'running')
        .filter((j) => j.last_heartbeat_at === null || j.last_heartbeat_at < staleBeforeIso)
        .filter((j) => j.lease_until === null || j.lease_until < nowIso)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, limit)
        .map((j) => ({ ...j }))
    },
    async countRunningJobs(nowIso) {
      return [...byId.values()].filter((j) => j.status === 'running' && (j.lease_until ?? '') > nowIso).length
    },
  }

  return { store, byId, rows }
}

type DepsBundle = {
  deps: LeagueRunnerDeps
  refunds: Array<{ userId: string; amount: number }>
  generateCalls: Array<{ tier: string; exclude: string[]; reuse: boolean; skipConsensus: boolean }>
  finalized: string[]
  runScheduled: () => Promise<void>
}

/** Fake generate: every outstanding model in the tier answers 'up' instantly. */
function answeringGenerate(rows: ModelRowFact[]): GenerateTierChunk {
  return async ({ tier, excludeModelIds, onModelResult }) => {
    const excluded = new Set(excludeModelIds)
    for (const id of TIERS[tier]) {
      if (excluded.has(id)) continue
      rows.push({ model_id: id, predicted_direction: 'up', predicted_at: new Date().toISOString() })
      onModelResult(id)
    }
  }
}

function makeDeps(
  fake: ReturnType<typeof makeStore>,
  over: Partial<LeagueRunnerDeps> = {}
): DepsBundle {
  const refunds: DepsBundle['refunds'] = []
  const generateCalls: DepsBundle['generateCalls'] = []
  const finalized: string[] = []
  const scheduled: Array<() => Promise<void>> = []

  const baseGenerate = answeringGenerate(fake.rows)
  const deps: LeagueRunnerDeps = {
    store: fake.store,
    generate: async (args) => {
      generateCalls.push({
        tier: args.tier,
        exclude: [...args.excludeModelIds].sort(),
        reuse: args.reusePersistedPacket === true,
        skipConsensus: args.skipConsensusPersist === true,
      })
      return (over.generate ?? baseGenerate)(args)
    },
    finalizeConsensus: async (roundId) => {
      finalized.push(roundId)
    },
    refundCredits: async (userId, amount) => {
      refunds.push({ userId, amount })
    },
    tierModelIds: over.tierModelIds ?? ((tier) => [...TIERS[tier]]),
    priceAnchorGate: over.priceAnchorGate ?? (async () => 'proceed'),
    schedule: (task) => {
      scheduled.push(task)
    },
    ...('now' in over ? { now: over.now } : {}),
    ...('tickBudgetMs' in over ? { tickBudgetMs: over.tickBudgetMs } : {}),
    ...(over.parallelTiers !== undefined ? { parallelTiers: over.parallelTiers } : {}),
    ...(over.ensurePacket ? { ensurePacket: over.ensurePacket } : {}),
    ...(over.createCallGate ? { createCallGate: over.createCallGate } : {}),
  }

  const runScheduled = async () => {
    for (const task of scheduled.splice(0)) await task()
  }

  return { deps, refunds, generateCalls, finalized, runScheduled }
}

describe('excludedModelIds (resume state from model_predictions)', () => {
  const jobCreatedAt = '2026-09-14T02:00:00.000Z'

  it('a real direction is finished work — never redone', () => {
    const excluded = excludedModelIds(
      [{ model_id: 'p1', predicted_direction: 'down', predicted_at: '2026-09-01T00:00:00.000Z' }],
      jobCreatedAt
    )
    expect(excluded.has('p1')).toBe(true)
  })

  it('a 결번 (null) row written DURING this job stays final for it', () => {
    const excluded = excludedModelIds(
      [{ model_id: 'p2', predicted_direction: null, predicted_at: '2026-09-14T02:30:00.000Z' }],
      jobCreatedAt
    )
    expect(excluded.has('p2')).toBe(true)
  })

  it('a 결번 row from an EARLIER job is retried by a fresh paid job', () => {
    const excluded = excludedModelIds(
      [{ model_id: 'p3', predicted_direction: null, predicted_at: '2026-09-13T23:00:00.000Z' }],
      jobCreatedAt
    )
    expect(excluded.has('p3')).toBe(false)
  })
})

describe('runner happy path', () => {
  it('runs all stages, resumes past finished models, finalizes once', async () => {
    // Premier fully done from a previous (dead) job; c1 answered; c2 timed out
    // BEFORE this job was created (so it gets one more chance); rest missing.
    const preRows: ModelRowFact[] = [
      ...TIERS.premier.map((id) => ({ model_id: id, predicted_direction: 'up', predicted_at: '2026-09-13T00:00:00.000Z' })),
      { model_id: 'c1', predicted_direction: 'down', predicted_at: '2026-09-13T00:00:00.000Z' },
      { model_id: 'c2', predicted_direction: null, predicted_at: '2026-09-13T00:00:00.000Z' },
    ]
    const fake = makeStore([makeJob()], preRows)
    const bundle = makeDeps(fake)

    const outcome = await advanceLeagueGenerationJob('job-1', bundle.deps)
    expect(outcome.claimed).toBe(true)
    await bundle.runScheduled()

    // Premier had zero outstanding models → no fan-out call for it at all.
    expect(bundle.generateCalls.map((c) => c.tier)).toEqual(['challenger', 'world', 'scout'])
    // The challenger call excluded every finished model — including c1 —
    // but NOT c2, whose null row predates the job.
    const challengerCall = bundle.generateCalls[0]
    expect(challengerCall.exclude).toContain('c1')
    expect(challengerCall.exclude).not.toContain('c2')
    for (const id of TIERS.premier) expect(challengerCall.exclude).toContain(id)

    expect(bundle.finalized).toEqual(['round-1'])
    const job = fake.byId.get('job-1')!
    expect(job.status).toBe('done')
    expect(job.stage).toBe('done')
    expect(job.attempt_count).toBe(0)
    expect(job.lease_until).toBeNull()
    expect(job.completed_at).not.toBeNull()
    // No refunds on success.
    expect(bundle.refunds).toEqual([])
  })

  it('stops at the tick budget, persists the stage, and releases the lease', async () => {
    const fake = makeStore([makeJob()])
    // Negative budget: the deadline is already past after the first stage.
    const bundle = makeDeps(fake, { tickBudgetMs: -1 })

    await advanceLeagueGenerationJob('job-1', bundle.deps)
    await bundle.runScheduled()

    // Only the packet stage (premier tier) ran in this tick.
    expect(bundle.generateCalls.map((c) => c.tier)).toEqual(['premier'])
    const job = fake.byId.get('job-1')!
    expect(job.status).toBe('running')
    expect(job.stage).toBe('challenger') // persisted resume point
    expect(job.lease_until).toBeNull() // lease released for the next tick
    expect(job.attempt_count).toBe(0) // progress was made → budget reset

    // Subsequent ticks pick up exactly where it stopped and finish:
    // challenger → world → scout → extra → finalize, one stage per (budgetless) tick.
    for (let tick = 0; tick < 6 && fake.byId.get('job-1')!.status !== 'done'; tick++) {
      await advanceLeagueGenerationJob('job-1', bundle.deps)
      await bundle.runScheduled()
    }
    expect(fake.byId.get('job-1')!.status).toBe('done')
    expect(bundle.finalized).toEqual(['round-1'])
  })

  it('defers an over-budget seat, still runs later seats, and the next tick resumes it', async () => {
    const premier = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']
    const fake = makeStore([makeJob()])
    const generate: GenerateTierChunk = async ({ tier, excludeModelIds, deadlineAtMs, tickBudgetMs, onModelResult }) => {
      const roster = (tier === 'premier' ? premier : [...TIERS[tier]])
        .filter((id) => !excludeModelIds.includes(id))
        .map((model_id) => ({ model_id, timeoutMs: model_id === 'p6' ? 240_000 : 60_000 }))
      const cursor = { nextIndex: 0 }
      const launchedThisChunk = { launched: 0 }
      for (;;) {
        const i = claimNextLaunchableIndex(roster, cursor, {
          nowMs: Date.now(),
          deadlineAtMs,
          defaultTimeoutMs: 60_000,
          tickBudgetMs,
          launchedThisChunk,
        })
        if (i === null) return
        const id = roster[i]!.model_id
        fake.rows.push({ model_id: id, predicted_direction: 'up', predicted_at: new Date().toISOString() })
        onModelResult(id)
      }
    }
    const tierModelIds: LeagueRunnerDeps['tierModelIds'] = (tier) =>
      tier === 'premier' ? [...premier] : [...TIERS[tier]]

    const first = makeDeps(fake, { generate, tierModelIds, tickBudgetMs: 90_000 })
    await advanceLeagueGenerationJob('job-1', first.deps)
    await first.runScheduled()

    const premierWritten = fake.rows.map((r) => r.model_id).filter((id) => premier.includes(id))
    expect(premierWritten).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p7', 'p8', 'p9'])
    expect(premierWritten).not.toContain('p6')
    const afterFirst = fake.byId.get('job-1')!
    expect(afterFirst.status).toBe('running')
    expect(afterFirst.stage).toBe('packet')
    expect(afterFirst.lease_until).toBeNull()

    const second = makeDeps(fake, { generate, tierModelIds, tickBudgetMs: 300_000 })
    await advanceLeagueGenerationJob('job-1', second.deps)
    await second.runScheduled()
    expect(fake.rows.map((r) => r.model_id)).toContain('p6')
    expect(fake.byId.get('job-1')!.status).toBe('done')
  })

  it('last premier seat with timeout == tick budget launches; no infinite 0-produced loop', async () => {
    const premier = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']
    const preRows = premier.slice(0, 9).map((id) => ({
      model_id: id,
      predicted_direction: 'up' as const,
      predicted_at: '2026-09-13T00:00:00.000Z',
    }))
    const fake = makeStore([makeJob()], preRows)
    const tickBudgetMs = 90_000
    const generate: GenerateTierChunk = async ({
      tier,
      excludeModelIds,
      deadlineAtMs,
      tickBudgetMs: chunkBudget,
      onModelResult,
    }) => {
      const roster = (tier === 'premier' ? premier : [...TIERS[tier]])
        .filter((id) => !excludeModelIds.includes(id))
        .map((model_id) => ({
          model_id,
          timeoutMs: model_id === 'p9' ? chunkBudget : 60_000,
        }))
      const cursor = { nextIndex: 0 }
      const launchedThisChunk = { launched: 0 }
      // Live leftover-deepseek chunks measured ~2173ms of overhead before claim.
      const nowMs = deadlineAtMs - chunkBudget + 2_173
      for (;;) {
        const i = claimNextLaunchableIndex(roster, cursor, {
          nowMs,
          deadlineAtMs,
          defaultTimeoutMs: 60_000,
          tickBudgetMs: chunkBudget,
          launchedThisChunk,
        })
        if (i === null) return
        const id = roster[i]!.model_id
        fake.rows.push({ model_id: id, predicted_direction: 'up', predicted_at: new Date().toISOString() })
        onModelResult(id)
      }
    }
    const tierModelIds: LeagueRunnerDeps['tierModelIds'] = (tier) =>
      tier === 'premier' ? [...premier] : [...TIERS[tier]]

    const bundle = makeDeps(fake, { generate, tierModelIds, tickBudgetMs })
    let ticks = 0
    while (fake.byId.get('job-1')!.stage === 'packet' && ticks < 5) {
      await advanceLeagueGenerationJob('job-1', bundle.deps)
      await bundle.runScheduled()
      ticks += 1
    }

    expect(fake.rows.some((r) => r.model_id === 'p9')).toBe(true)
    expect(fake.byId.get('job-1')!.stage).not.toBe('packet')
    expect(ticks).toBeLessThan(5)
    expect(ticks).toBeGreaterThan(0)
  })
})

describe('failure and refund safety', () => {
  it('a job that exhausts its attempts refunds exactly once — including racing close-outs', async () => {
    const payerJob = makeJob({ id: 'job-1', attempt_count: LEAGUE_JOB_MAX_ATTEMPTS, status: 'running' })
    // A second viewer bought access to the same round while it was running.
    const attachedPurchase = makeJob({
      id: 'purchase-2',
      user_id: 'user-2',
      status: 'done',
      stage: 'view',
      charged: true,
    })
    // An admin's row: deduct was skipped, charged=false → no money to return.
    const adminRow = makeJob({
      id: 'admin-3',
      user_id: 'admin-1',
      status: 'done',
      stage: 'view',
      charged: false,
      charged_cost: 0,
      deduct_skipped: true,
    })
    const fake = makeStore([payerJob, attachedPurchase, adminRow])
    const bundle = makeDeps(fake)

    // The claim bumps attempt_count past the cap; the chunk closes it out.
    const outcome = await advanceLeagueGenerationJob('job-1', bundle.deps)
    expect(outcome.claimed).toBe(true)
    await bundle.runScheduled()

    const job = fake.byId.get('job-1')!
    expect(job.status).toBe('failed')
    expect(job.refunded).toBe(true)
    expect(fake.byId.get('purchase-2')!.refunded).toBe(true)
    // Every charged purchase refunded once; the uncharged admin row untouched.
    expect(bundle.refunds).toEqual([
      { userId: 'user-1', amount: 30 },
      { userId: 'user-2', amount: 30 },
    ])
    expect(fake.byId.get('admin-3')!.refunded).toBe(false)

    // A racing second close-out (stale sweeper, double cron, anything) finds
    // every refunded flag already flipped and moves NO money.
    await runLeagueGenerationChunk({ ...job, attempt_count: LEAGUE_JOB_MAX_ATTEMPTS + 1 }, bundle.deps)
    expect(bundle.refunds).toHaveLength(2)

    // And the terminal job can never be claimed again.
    const again = await advanceLeagueGenerationJob('job-1', bundle.deps)
    expect(again.claimed).toBe(false)
    expect(again.status).toBe('failed')
  })

  it('a generate throw drops the lease with the error recorded, job stays retryable', async () => {
    const fake = makeStore([makeJob()])
    const bundle = makeDeps(fake, {
      generate: async () => {
        throw new Error('packet unavailable: provider 500')
      },
    })

    await advanceLeagueGenerationJob('job-1', bundle.deps)
    await bundle.runScheduled()

    const job = fake.byId.get('job-1')!
    expect(job.status).toBe('running') // NOT failed — the sweeper retries it
    expect(job.lease_until).toBeNull() // lease dropped for a prompt reclaim
    expect(job.last_error).toContain('packet unavailable')
    expect(job.attempt_count).toBe(1) // no progress → the count stands
    expect(bundle.refunds).toEqual([]) // no refund until the cap is hit

    // The next sweep can claim it immediately.
    const retry = await advanceLeagueGenerationJob('job-1', bundle.deps)
    expect(retry.claimed).toBe(true)
  })

  it('a close-higher job with no persisted anchor fails and refunds — never fans out', async () => {
    const payerJob = makeJob({ id: 'job-1' })
    const attachedPurchase = makeJob({
      id: 'purchase-2',
      user_id: 'user-2',
      status: 'done',
      stage: 'view',
      charged: true,
    })
    const fake = makeStore([payerJob, attachedPurchase])
    const bundle = makeDeps(fake, { priceAnchorGate: async () => 'fail' })

    await advanceLeagueGenerationJob('job-1', bundle.deps)
    await bundle.runScheduled()

    const job = fake.byId.get('job-1')!
    expect(job.status).toBe('failed')
    expect(job.last_error).toContain('missing_anchor')
    expect(bundle.generateCalls).toEqual([])
    expect(bundle.finalized).toEqual([])
    expect(bundle.refunds).toEqual([
      { userId: 'user-1', amount: 30 },
      { userId: 'user-2', amount: 30 },
    ])
    expect(fake.byId.get('purchase-2')!.refunded).toBe(true)
  })
})

describe('sweep global concurrency cap', () => {
  it(`never lets more than ${LEAGUE_JOB_MAX_RUNNING} jobs run at once`, async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const running = Array.from({ length: LEAGUE_JOB_MAX_RUNNING }, (_, i) =>
      makeJob({ id: `run-${i}`, round_id: `round-run-${i}`, status: 'running', lease_until: future })
    )
    const queued = [makeJob({ id: 'q-1', round_id: 'round-q1' }), makeJob({ id: 'q-2', round_id: 'round-q2' })]
    const fake = makeStore([...running, ...queued])
    const bundle = makeDeps(fake)

    const summary = await sweepLeagueGenerationJobs(bundle.deps)
    expect(summary.runningBefore).toBe(LEAGUE_JOB_MAX_RUNNING)
    expect(summary.claimed).toBe(0)
    expect(fake.byId.get('q-1')!.status).toBe('queued')
  })

  it('claims only up to the remaining budget', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const running = Array.from({ length: LEAGUE_JOB_MAX_RUNNING - 1 }, (_, i) =>
      makeJob({ id: `run-${i}`, round_id: `round-run-${i}`, status: 'running', lease_until: future })
    )
    const queued = [
      makeJob({ id: 'q-1', round_id: 'round-q1', created_at: '2026-09-14T00:00:00.000Z' }),
      makeJob({ id: 'q-2', round_id: 'round-q2', created_at: '2026-09-14T00:00:01.000Z' }),
    ]
    const fake = makeStore([...running, ...queued])
    const bundle = makeDeps(fake)

    const summary = await sweepLeagueGenerationJobs(bundle.deps)
    expect(summary.claimed).toBe(1)
    // Oldest first.
    expect(summary.results[0]?.jobId).toBe('q-1')
    expect(fake.byId.get('q-2')!.status).toBe('queued')
    await bundle.runScheduled()
    expect(fake.byId.get('q-1')!.status).toBe('done')
  })
})

describe('LEAGUE_PARALLEL_TIERS off (default)', () => {
  it('keeps the sequential tier call order', async () => {
    const fake = makeStore([makeJob()])
    const bundle = makeDeps(fake)
    await advanceLeagueGenerationJob('job-1', bundle.deps)
    await bundle.runScheduled()
    expect(bundle.generateCalls.map((c) => c.tier)).toEqual(['premier', 'challenger', 'world', 'scout'])
    expect(bundle.generateCalls.every((c) => c.reuse === false && c.skipConsensus === false)).toBe(true)
    expect(bundle.finalized).toEqual(['round-1'])
    expect(fake.byId.get('job-1')!.status).toBe('done')
  })
})

describe('LEAGUE_PARALLEL_TIERS on', () => {
  it('builds the packet once and starts all four official tiers before any finishes', async () => {
    const fake = makeStore([makeJob()])
    let packetBuilds = 0
    let started = 0
    let release: () => void = () => {}
    const allStarted = new Promise<void>((resolve) => {
      release = resolve
    })
    const finishedTiers: string[] = []
    const bundle = makeDeps(fake, {
      parallelTiers: true,
      ensurePacket: async () => {
        packetBuilds += 1
        return { built: true, packetMs: 5 }
      },
      generate: async ({ tier, onModelResult }) => {
        started += 1
        if (started === 4) release()
        await allStarted
        if (tier === 'extra') {
          finishedTiers.push(tier)
          return { deferred: 0, http429: 0 }
        }
        for (const id of TIERS[tier as keyof typeof TIERS]) {
          fake.rows.push({ model_id: id, predicted_direction: 'up', predicted_at: new Date().toISOString() })
          onModelResult(id)
        }
        finishedTiers.push(tier)
        return { deferred: 0, http429: 0 }
      },
    })

    await advanceLeagueGenerationJob('job-1', bundle.deps)
    await bundle.runScheduled()

    expect(packetBuilds).toBe(1)
    expect(bundle.generateCalls.slice(0, 4).map((c) => c.tier)).toEqual(['premier', 'challenger', 'world', 'scout'])
    expect(bundle.generateCalls.slice(0, 4).every((c) => c.reuse && c.skipConsensus)).toBe(true)
    expect(finishedTiers.indexOf('extra')).toBe(-1)
    expect(bundle.generateCalls.some((c) => c.tier === 'extra')).toBe(false)
    expect(bundle.finalized).toEqual(['round-1'])
    expect(fake.byId.get('job-1')!.stage).toBe('done')
  })

  it('defers an over-budget seat and resumes it on the next chunk before extras', async () => {
    const premier = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']
    const fake = makeStore([makeJob()])
    const tierModelIds: LeagueRunnerDeps['tierModelIds'] = (tier) => {
      if (tier === 'premier') return [...premier]
      if (tier === 'extra') return ['crow']
      return [...TIERS[tier]]
    }
    const generate: GenerateTierChunk = async ({
      tier,
      excludeModelIds,
      deadlineAtMs,
      tickBudgetMs: chunkBudget,
      onModelResult,
    }) => {
      const ids = (tier === 'premier' ? premier : tier === 'extra' ? ['crow'] : [...TIERS[tier]]).filter(
        (id) => !excludeModelIds.includes(id),
      )
      const roster = ids.map((model_id) => ({
        model_id,
        timeoutMs: model_id === 'p6' ? 240_000 : 1_000,
      }))
      const cursor = { nextIndex: 0 }
      const launchedThisChunk = { launched: 0 }
      let deferred = 0
      for (;;) {
        const before = cursor.nextIndex
        const i = claimNextLaunchableIndex(roster, cursor, {
          nowMs: Date.now(),
          deadlineAtMs,
          defaultTimeoutMs: 1_000,
          tickBudgetMs: chunkBudget,
          launchedThisChunk,
        })
        if (i === null) {
          deferred += Math.max(0, roster.length - before)
          return { deferred, http429: 0 }
        }
        deferred += Math.max(0, i - before)
        const id = roster[i]!.model_id
        fake.rows.push({
          model_id: id,
          predicted_direction: id === 'p1' ? null : 'up',
          predicted_at: new Date().toISOString(),
        })
        onModelResult(id)
      }
    }

    const first = makeDeps(fake, { parallelTiers: true, generate, tierModelIds, tickBudgetMs: 90_000 })
    await advanceLeagueGenerationJob('job-1', first.deps)
    await first.runScheduled()

    expect(fake.rows.some((r) => r.model_id === 'p6')).toBe(false)
    expect(first.generateCalls.some((c) => c.tier === 'extra')).toBe(false)
    expect(fake.byId.get('job-1')!.stage).toBe('packet')
    expect(first.finalized).toEqual([])

    const second = makeDeps(fake, { parallelTiers: true, generate, tierModelIds, tickBudgetMs: 300_000 })
    await advanceLeagueGenerationJob('job-1', second.deps)
    await second.runScheduled()

    expect(fake.rows.some((r) => r.model_id === 'p6')).toBe(true)
    const extraAt = second.generateCalls.findIndex((c) => c.tier === 'extra')
    const official = second.generateCalls.filter((c) => c.tier !== 'extra')
    expect(official.length).toBeGreaterThan(0)
    expect(extraAt).toBe(official.length)
    expect(second.finalized).toEqual(['round-1'])
    expect(fake.byId.get('job-1')!.status).toBe('done')
  })

  it('counts a parallel job as weight 2 against the running cap', async () => {
    expect(generationClaimBudget(0, false)).toBe(LEAGUE_JOB_MAX_RUNNING)
    expect(generationClaimBudget(1, false)).toBe(LEAGUE_JOB_MAX_RUNNING - 1)
    expect(generationClaimBudget(0, true)).toBe(1)
    expect(generationClaimBudget(1, true)).toBe(0)

    const future = new Date(Date.now() + 60_000).toISOString()
    const fake = makeStore([
      makeJob({ id: 'run-1', round_id: 'round-run', status: 'running', lease_until: future }),
      makeJob({ id: 'q-1', round_id: 'round-q1' }),
    ])
    const bundle = makeDeps(fake, { parallelTiers: true })
    const blocked = await sweepLeagueGenerationJobs(bundle.deps)
    expect(blocked.runningBefore).toBe(1)
    expect(blocked.claimed).toBe(0)
    expect(fake.byId.get('q-1')!.status).toBe('queued')

    const open = makeStore([makeJob({ id: 'q-1' }), makeJob({ id: 'q-2', round_id: 'round-q2' })])
    const openBundle = makeDeps(open, { parallelTiers: true })
    const summary = await sweepLeagueGenerationJobs(openBundle.deps)
    expect(summary.claimed).toBe(1)
    expect(open.byId.get('q-2')!.status).toBe('queued')
  })

  it('finalizes consensus from official rows and ignores null failures and extra seats', () => {
    const rows = [
      { model_id: 'p1', league_tier: 'premier', direction: 'up', probability: 70 },
      { model_id: 'p2', league_tier: 'premier', direction: null, probability: null },
      { model_id: 'c1', league_tier: 'challenger', direction: 'up', probability: 60 },
      { model_id: 'crow', league_tier: 'extra', direction: 'down', probability: 90 },
    ]
    const official = officialRowsForConsensus(rows)
    expect(official.map((row) => row.model_id)).toEqual(['p1', 'p2', 'c1'])
    const dual = dualConsensus(binaryCallsFromModels(official))
    expect(dual.majority.direction).toBe('up')
    expect(dual.aggregate.direction).toBe('up')
  })

  it('shares one packet build and never exceeds the in-flight caps, including a retry acquire', async () => {
    let builds = 0
    const first = coalesceRoundPacketBuild('round-1', async () => {
      builds += 1
      await new Promise((resolve) => setTimeout(resolve, 15))
      return 'packet'
    })
    const second = coalesceRoundPacketBuild('round-1', async () => {
      builds += 1
      return 'other'
    })
    await expect(Promise.all([first, second])).resolves.toEqual(['packet', 'packet'])
    expect(builds).toBe(1)

    const gate = createProviderCallGate()
    for (let i = 0; i < 8; i++) await gate.acquire('openrouter')
    for (let i = 0; i < 8; i++) await gate.acquire('openai')
    expect(gate.inFlight).toBe(16)
    expect(gate.openRouterInFlight).toBe(8)

    let extraOpenRouter = false
    const waitingOr = gate.acquire('openrouter').then(() => {
      extraOpenRouter = true
    })
    let extraOpenAi = false
    const waitingOai = gate.acquire('openai').then(() => {
      extraOpenAi = true
    })
    await Promise.resolve()
    expect(extraOpenRouter).toBe(false)
    expect(extraOpenAi).toBe(false)
    expect(gate.maxInFlightSeen).toBe(16)
    expect(gate.maxOpenRouterSeen).toBe(8)

    gate.release('openai')
    await waitingOai
    expect(extraOpenAi).toBe(true)
    expect(extraOpenRouter).toBe(false)
    expect(gate.inFlight).toBe(16)
    expect(gate.openRouterInFlight).toBe(8)

    gate.release('openrouter')
    await waitingOr
    expect(extraOpenRouter).toBe(true)
    expect(gate.openRouterInFlight).toBe(8)
    expect(gate.maxInFlightSeen).toBeLessThanOrEqual(16)
    expect(gate.maxOpenRouterSeen).toBeLessThanOrEqual(8)
    while (gate.inFlight > 0) {
      if (gate.openRouterInFlight > 0) gate.release('openrouter')
      else gate.release('openai')
    }

    let attempts = 0
    const retry = async () => {
      await gate.acquire('openrouter')
      attempts += 1
      gate.release('openrouter')
    }
    await retry()
    await retry()
    expect(attempts).toBe(2)
  })
})
