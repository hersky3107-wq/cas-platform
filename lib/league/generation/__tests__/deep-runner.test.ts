import { describe, expect, it } from 'vitest'
import type { DeepRunRow } from '../../deep-store'
import { LEAGUE_DEEP_MAX_RUNNING, LEAGUE_JOB_MAX_ATTEMPTS } from '../policy'
import {
  advanceDeepRun,
  refundDeepRunOnce,
  runDeepChunk,
  sweepLeagueDeepRuns,
  type DeepRunnerDeps,
  type DeepRunnerStore,
} from '../deep-runner'

function makeRun(over: Partial<DeepRunRow> = {}): DeepRunRow {
  return {
    id: over.id ?? 'deep-1',
    round_id: over.round_id ?? 'round-1',
    product: over.product ?? 'open',
    user_id: over.user_id ?? 'user-1',
    status: over.status ?? 'running',
    stage: over.stage ?? 'start',
    result: over.result ?? null,
    providers: over.providers ?? [],
    state: over.state ?? { instrument: 'AAPL' },
    charged: over.charged ?? true,
    charged_cost: over.charged_cost ?? 50,
    deduct_skipped: over.deduct_skipped ?? false,
    refunded: over.refunded ?? false,
    billed_usd: over.billed_usd ?? 0,
    estimated_usd: over.estimated_usd ?? 0,
    provider_calls: over.provider_calls ?? 0,
    busy_until: over.busy_until ?? null,
    attempt_count: over.attempt_count ?? 0,
    lease_until: over.lease_until ?? null,
    last_heartbeat_at: over.last_heartbeat_at ?? null,
    last_error: over.last_error ?? null,
    created_at: over.created_at ?? '2026-09-14T00:00:00.000Z',
    updated_at: over.updated_at ?? '2026-09-14T00:00:00.000Z',
  }
}

function makeStore(runs: DeepRunRow[]) {
  const byId = new Map(runs.map((r) => [r.id, r]))
  const store: DeepRunnerStore = {
    async getRun(id) {
      const row = byId.get(id)
      return row ? { ...row } : null
    },
    async claimLease(id, leaseUntil, nowIso) {
      const row = byId.get(id)
      if (!row) return null
      if (row.status === 'done' || row.status === 'error') return null
      if (row.busy_until && row.busy_until >= nowIso) return null
      if (row.lease_until !== null && row.lease_until >= nowIso) return null
      row.status = 'running'
      row.attempt_count += 1
      row.lease_until = leaseUntil
      row.last_heartbeat_at = nowIso
      return { ...row }
    },
    async updateRun(id, patch) {
      const row = byId.get(id)
      if (row) Object.assign(row, patch)
    },
    async touchHeartbeat(id, nowIso) {
      const row = byId.get(id)
      if (row) row.last_heartbeat_at = nowIso
    },
    async markRefundedOnce(id) {
      const row = byId.get(id)
      if (!row || !row.charged || row.refunded) return null
      row.refunded = true
      return { ...row }
    },
    async listClaimable(limit, staleBeforeIso, nowIso) {
      return [...byId.values()]
        .filter((r) => r.status === 'running')
        .filter((r) => r.last_heartbeat_at === null || r.last_heartbeat_at < staleBeforeIso)
        .filter((r) => r.lease_until === null || r.lease_until < nowIso)
        .filter((r) => r.busy_until === null || r.busy_until < nowIso)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, limit)
        .map((r) => ({ ...r }))
    },
    async countRunning(nowIso) {
      return [...byId.values()].filter((r) => r.status === 'running' && (r.lease_until ?? '') > nowIso).length
    },
  }
  return { store, byId }
}

function makeDeps(fake: ReturnType<typeof makeStore>, over: Partial<DeepRunnerDeps> = {}) {
  const refunds: Array<{ userId: string; amount: number }> = []
  const scheduled: Array<() => Promise<void>> = []
  const deps: DeepRunnerDeps = {
    store: fake.store,
    seed: over.seed ?? (async (row) => ({ ok: true, row })),
    advanceHop: over.advanceHop ?? (async () => ({ done: true, ok: true })),
    refundCredits: async (userId, amount) => {
      refunds.push({ userId, amount })
    },
    schedule: (task) => {
      scheduled.push(task)
    },
  }
  return {
    deps,
    refunds,
    runScheduled: async () => {
      for (const task of scheduled.splice(0)) await task()
    },
  }
}

describe('deep runner refund-once', () => {
  it('an exhausted job refunds exactly once even if close-out races', async () => {
    const fake = makeStore([makeRun({ attempt_count: LEAGUE_JOB_MAX_ATTEMPTS })])
    const bundle = makeDeps(fake)

    const outcome = await advanceDeepRun('deep-1', bundle.deps)
    expect(outcome.claimed).toBe(true)
    await bundle.runScheduled()

    expect(fake.byId.get('deep-1')!.status).toBe('error')
    expect(fake.byId.get('deep-1')!.refunded).toBe(true)
    expect(bundle.refunds).toEqual([{ userId: 'user-1', amount: 50 }])

    await runDeepChunk({ ...fake.byId.get('deep-1')!, attempt_count: LEAGUE_JOB_MAX_ATTEMPTS + 1 }, bundle.deps)
    expect(bundle.refunds).toHaveLength(1)
  })

  it('refundDeepRunOnce is a no-op the second time', async () => {
    const fake = makeStore([makeRun()])
    const bundle = makeDeps(fake)
    expect(await refundDeepRunOnce(fake.byId.get('deep-1')!, bundle.deps)).toBe(true)
    expect(await refundDeepRunOnce(fake.byId.get('deep-1')!, bundle.deps)).toBe(false)
    expect(bundle.refunds).toHaveLength(1)
  })

  it('admin deduct_skipped rows flip refunded but move no credits', async () => {
    const fake = makeStore([makeRun({ deduct_skipped: true, charged_cost: 0, charged: true })])
    const bundle = makeDeps(fake)
    await refundDeepRunOnce(fake.byId.get('deep-1')!, bundle.deps)
    expect(fake.byId.get('deep-1')!.refunded).toBe(true)
    expect(bundle.refunds).toEqual([])
  })
})

describe('busy_until vs lease', () => {
  it('does not claim a row whose 280s HTTP lock is still live', async () => {
    const future = new Date(Date.now() + 280_000).toISOString()
    const fake = makeStore([makeRun({ busy_until: future })])
    const bundle = makeDeps(fake)
    const outcome = await advanceDeepRun('deep-1', bundle.deps)
    expect(outcome.claimed).toBe(false)
    expect(fake.byId.get('deep-1')!.attempt_count).toBe(0)
  })
})

describe('hop handoff', () => {
  it('clears the heartbeat after a non-terminal hop so the next sweep can claim without a 60s stale wait', async () => {
    const fake = makeStore([makeRun({ state: { instrument: 'AAPL' } })])
    const bundle = makeDeps(fake, {
      advanceHop: async () => ({ done: false, stage: 'plan' }),
    })
    const outcome = await advanceDeepRun('deep-1', bundle.deps)
    expect(outcome.claimed).toBe(true)
    await bundle.runScheduled()
    expect(fake.byId.get('deep-1')!.lease_until).toBeNull()
    expect(fake.byId.get('deep-1')!.last_heartbeat_at).toBeNull()
    expect(fake.byId.get('deep-1')!.attempt_count).toBe(0)
    expect(fake.byId.get('deep-1')!.status).toBe('running')

    const summary = await sweepLeagueDeepRuns(bundle.deps)
    expect(summary.claimed).toBe(1)
  })
})

describe('deep running cap (own budget, not generation\'s 3)', () => {
  it(`never claims a ${LEAGUE_DEEP_MAX_RUNNING + 1}th concurrent deep run`, async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const running = Array.from({ length: LEAGUE_DEEP_MAX_RUNNING }, (_, i) =>
      makeRun({ id: `run-${i}`, round_id: `r-${i}`, lease_until: future, status: 'running' })
    )
    const waiting = makeRun({ id: 'wait-1', round_id: 'r-wait' })
    const fake = makeStore([...running, waiting])
    const bundle = makeDeps(fake)
    const summary = await sweepLeagueDeepRuns(bundle.deps)
    expect(summary.runningBefore).toBe(LEAGUE_DEEP_MAX_RUNNING)
    expect(summary.claimed).toBe(0)
    expect(fake.byId.get('wait-1')!.attempt_count).toBe(0)
  })
})
