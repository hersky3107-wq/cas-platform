/**
 * The chunked advance path: lease, idempotency, 결번 handling, and the
 * read-only poll.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRISM_COLORS } from '../../engines/prism'
import { layer1Entry } from '../../ai/registry'
import type { OracleJobSession } from '../../schema'
import { advanceOracleSession, runOracleChunk, type AdvanceDeps } from '../advance'
import { createStubAiAdapter } from '../ai-stub'
import { releaseAiSlots, resetAiSlots, tryAcquireAiSlots } from '../concurrency'
import {
  ORACLE_LAYER1_CHUNK_SIZE,
  ORACLE_MAX_ATTEMPTS,
  ORACLE_MAX_CONCURRENT_AI_UNITS,
  ORACLE_STALE_HEARTBEAT_SECONDS,
} from '../conventions'
import { createOracleSession } from '../create'
import { readOracleSession } from '../poll'
import { readingUnit } from '../progress'
import { sweepOracleSessions } from '../sweep'
import type { OracleAiAdapter, OracleAiResult } from '../types'
import { createFakeCredits, createFakeStore, createScheduler, makeProfile, type FakeCredits, type FakeStore } from './fakes'

const NOW = new Date('2026-08-20T03:00:00.000Z')
const USER = 'user-1'
const PRISM_INPUTS = {
  prism: {
    impulse: PRISM_COLORS[0],
    need: PRISM_COLORS[1],
    identity: PRISM_COLORS[2],
    microCheck: [3, 4, 2, 3] as const,
  },
}

/** Hangs for `delayMs` so the runner's per-unit deadline and lease renewal can be exercised. */
function delayedAi(delayMs: number): OracleAiAdapter {
  return {
    async run() {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs)
      })
      return {
        ok: true,
        brand: 'stub',
        model: 'stub-oracle-v0',
        text: '[stub] delayed reading',
        summary: { headline: 'delayed' },
        latencyMs: delayMs,
        tokensIn: 1,
        tokensOut: 1,
      }
    },
  }
}

/** No real waiting: the stub's delay is injected away so tests stay instant. */
function fastAi(): OracleAiAdapter {
  return createStubAiAdapter({ minDelayMs: 0, maxDelayMs: 0, sleep: async () => {} })
}

/** Hangs forever on one reading, so the runner's own deadline has to fire. */
function hangOn(unit: string, inner: OracleAiAdapter): OracleAiAdapter {
  return {
    run(request, options) {
      if (request.kind === 'reading' && request.unit === unit) {
        return new Promise<OracleAiResult>(() => {})
      }
      return inner.run(request, options)
    },
  }
}

type Harness = {
  store: FakeStore
  credits: FakeCredits
  session: OracleJobSession
  deps: (overrides?: Partial<AdvanceDeps>) => AdvanceDeps & { drain: () => Promise<void>; pending: () => number }
}

async function bootstrap(
  options: {
    ai?: OracleAiAdapter
    readerCount?: 3 | 5 | 7 | 9
    withPrismInputs?: boolean
    scope?: 'single' | 'combined'
    systems?: string[]
  } = {},
): Promise<Harness> {
  const profile = makeProfile()
  const store = createFakeStore({ profiles: [profile] })
  const credits = createFakeCredits()

  const created = await createOracleSession(
    USER,
    {
      kind: 'personal',
      subjectProfileId: profile.id,
      scope: options.scope ?? 'combined',
      systems: options.systems ?? [],
      question: null,
      sessionInputs: options.withPrismInputs === false ? null : PRISM_INPUTS,
      readerCount: options.readerCount ?? 3,
      locale: 'ko',
    },
    { store, credits, now: () => NOW, seed: () => 'seed-advance' },
  )
  if (!created.ok) throw new Error('bootstrap failed to create a session')

  return {
    store,
    credits,
    session: created.session,
    deps: (overrides = {}) => {
      const scheduler = createScheduler()
      return {
        store,
        credits,
        ai: options.ai ?? fastAi(),
        schedule: scheduler.schedule,
        now: () => NOW,
        unitTimeoutMs: 20,
        drain: scheduler.drain,
        pending: scheduler.pending,
        ...overrides,
      }
    },
  }
}

/** Drives advance + chunk until the session is terminal. */
async function runToCompletion(harness: Harness, ai?: OracleAiAdapter): Promise<OracleJobSession> {
  for (let i = 0; i < 20; i++) {
    const deps = harness.deps(ai ? { ai } : {})
    const outcome = await advanceOracleSession(harness.session.id, deps)
    await deps.drain()
    if (!outcome.found) break
    const current = await harness.store.getSession(harness.session.id)
    if (current && (current.status === 'done' || current.status === 'partial' || current.status === 'failed')) {
      return current
    }
  }
  throw new Error('session did not reach a terminal status')
}

beforeEach(() => {
  resetAiSlots()
  vi.stubEnv('ORACLE_AI_MODE', 'live')
})

describe('lease', () => {
  it('makes a second advance a no-op while the first holds it', async () => {
    const harness = await bootstrap()
    const first = harness.deps()
    const claimed = await advanceOracleSession(harness.session.id, first)
    expect(claimed.claimed).toBe(true)
    expect(first.pending()).toBe(1)

    const second = harness.deps()
    const blocked = await advanceOracleSession(harness.session.id, second)
    expect(blocked.claimed).toBe(false)
    expect(blocked.status).toBe('layer1')
    // No work scheduled: the second caller reports status and stops.
    expect(second.pending()).toBe(0)

    await first.drain()
    expect(harness.store.readings).toHaveLength(ORACLE_LAYER1_CHUNK_SIZE)
  })

  it('releases the lease when the chunk finishes so the next chunk can claim it', async () => {
    const harness = await bootstrap()
    const first = harness.deps()
    await advanceOracleSession(harness.session.id, first)
    await first.drain()

    expect((await harness.store.getSession(harness.session.id))!.lease_until).toBeNull()

    const second = harness.deps()
    const next = await advanceOracleSession(harness.session.id, second)
    expect(next.claimed).toBe(true)
  })

  it('keeps the lease through slow inserts after units exceed the old 90s lease window', async () => {
    vi.useFakeTimers({ now: NOW })
    try {
      const unitDelayMs = 85_000
      const insertDelayMs = 5_000
      const harness = await bootstrap({ ai: delayedAi(unitDelayMs) })

      const baseInsert = harness.store.insertReadingIfAbsent.bind(harness.store)
      harness.store.insertReadingIfAbsent = async (row) => {
        await new Promise<void>((resolve) => setTimeout(resolve, insertDelayMs))
        return baseInsert(row)
      }

      // Use the advancing fake clock (not the harness's frozen NOW) so in-flight
      // lease renewal tracks elapsed wall time.
      const deps = harness.deps({ unitTimeoutMs: 90_000, now: undefined })
      await advanceOracleSession(harness.session.id, deps)
      const drainPromise = deps.drain()

      await vi.advanceTimersByTimeAsync(unitDelayMs)
      await vi.advanceTimersByTimeAsync(insertDelayMs + 1_000)

      const session = (await harness.store.getSession(harness.session.id))!
      const elapsedMs = Date.now() - NOW.getTime()
      expect(elapsedMs).toBeGreaterThan(90_000)
      expect(session.lease_until).not.toBeNull()
      expect(new Date(session.lease_until!).getTime()).toBeGreaterThan(Date.now())
      expect(Date.now() - new Date(session.last_heartbeat_at!).getTime()).toBeLessThan(
        ORACLE_STALE_HEARTBEAT_SECONDS * 1_000,
      )

      const summary = await sweepOracleSessions(deps)
      expect(summary.candidates).toBe(0)

      await vi.runAllTimersAsync()
      await drainPromise
      expect(harness.store.readings).toHaveLength(ORACLE_LAYER1_CHUNK_SIZE)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses to claim a terminal session', async () => {
    const harness = await bootstrap()
    await runToCompletion(harness)
    const outcome = await advanceOracleSession(harness.session.id, harness.deps())
    expect(outcome.claimed).toBe(false)
    expect(outcome.status).toBe('done')
  })
})

describe('idempotency', () => {
  it('does not duplicate readings when the same chunk runs twice concurrently', async () => {
    const harness = await bootstrap()
    const deps = harness.deps()
    const claimed = await advanceOracleSession(harness.session.id, deps)
    expect(claimed.claimed).toBe(true)

    const snapshot = (await harness.store.getSession(harness.session.id))!
    // Two workers on the identical snapshot — what a stolen lease looks like.
    await Promise.all([runOracleChunk(snapshot, deps), runOracleChunk(snapshot, deps)])

    expect(harness.store.readings).toHaveLength(ORACLE_LAYER1_CHUNK_SIZE)
    expect(harness.store.duplicateCount).toBe(ORACLE_LAYER1_CHUNK_SIZE)
    const systems = harness.store.readings.map((row) => row.system)
    expect(new Set(systems).size).toBe(systems.length)
  })

  it('keeps integrated mode at exactly one row per system despite the looser DB key', async () => {
    const harness = await bootstrap()
    await runToCompletion(harness)

    expect(harness.store.readings).toHaveLength(12)
    expect(new Set(harness.store.readings.map((row) => row.system)).size).toBe(12)
    for (const system of harness.session.systems) {
      expect(harness.store.readings.filter((row) => row.system === system)).toHaveLength(1)
    }
    expect(harness.store.verdicts).toHaveLength(3)
    expect(new Set(harness.store.verdicts.map((row) => row.reader_slug)).size).toBe(3)
  })

  it('rejects a duplicate row at the store boundary — the UNIQUE constraint', async () => {
    const harness = await bootstrap()
    const computation = harness.store.computations[0]!
    const row = {
      session_id: harness.session.id,
      computation_id: computation.id,
      system: computation.system,
      brand: 'stub',
      model: 'stub',
      narrative: 'first',
      summary: null,
      status: 'done' as const,
      latency_ms: 1,
      tokens_in: 1,
      tokens_out: 1,
    }

    expect(await harness.store.insertReadingIfAbsent(row)).toBe(true)
    expect(await harness.store.insertReadingIfAbsent({ ...row, narrative: 'second' })).toBe(false)
    expect(harness.store.readings.filter((entry) => entry.system === computation.system)).toHaveLength(1)
    expect(harness.store.readings[0]!.narrative).toBe('first')
  })
})

describe('결번 (a missing system)', () => {
  it('creates a PRISM reading from valid per-session inputs', async () => {
    const harness = await bootstrap()
    const final = await runToCompletion(harness)

    expect(final.status).toBe('done')
    const prism = harness.store.readings.find((row) => row.system === 'prism')
    expect(prism?.status).toBe('done')
    expect(prism?.narrative).not.toBeNull()
  })

  it('keeps PRISM as a 결번 without session inputs and still reaches done', async () => {
    const harness = await bootstrap({ withPrismInputs: false })
    const final = await runToCompletion(harness)

    expect(final.status).toBe('done')
    expect(harness.store.readings.some((row) => row.system === 'prism')).toBe(false)
    expect(final.progress.failed).toContain(readingUnit('prism', layer1Entry('prism')!.brand))
    expect(final.progress.pending).toHaveLength(0)
    expect(harness.credits.refunds).toHaveLength(0)
  })

  it('times a system out, records it as failed, and still reaches done', async () => {
    const harness = await bootstrap()
    const final = await runToCompletion(harness, hangOn('saju', fastAi()))

    expect(final.status).toBe('done')
    expect(final.next_action).toBeNull()
    expect(final.completed_at).toBe(NOW.toISOString())

    const saju = harness.store.readings.find((row) => row.system === 'saju')!
    expect(saju.status).toBe('timeout')
    expect(saju.narrative).toBeNull()

    expect(final.progress.failed).toContain(readingUnit('saju', layer1Entry('saju')!.brand))
    expect(final.progress.done).not.toContain(readingUnit('saju', layer1Entry('saju')!.brand))
    expect(final.progress.done).toContain(readingUnit('astro', layer1Entry('astro')!.brand))
    expect(final.progress.pending).toHaveLength(0)

    // The session is still charged: a blank seat is not a failure.
    expect(harness.credits.refunds).toHaveLength(0)
  })

  it('reports the missing system in the consensus unit stats', async () => {
    const harness = await bootstrap()
    await runToCompletion(harness, hangOn('saju', fastAi()))

    const stats = harness.store.consensus[0]!.domain_stats as { units: Record<string, number> }
    expect(stats.units.systemsReadable).toBe(12)
    expect(stats.units.readingsDone).toBe(11)
    expect(stats.units.readingsMissing).toBe(1)
  })
})

describe('single-system layer branches', () => {
  it('writes N brand-distinct readings, synthesizes, and never creates seer votes', async () => {
    const harness = await bootstrap({ scope: 'single', systems: ['saju'], readerCount: 3 })
    const final = await runToCompletion(harness)

    expect(final.status).toBe('done')
    expect(harness.store.readings).toHaveLength(3)
    expect(new Set(harness.store.readings.map((row) => row.system))).toEqual(new Set(['saju']))
    expect(new Set(harness.store.readings.map((row) => row.brand)).size).toBe(3)
    expect(harness.store.verdicts).toHaveLength(0)
    const synthesis = harness.store.consensus[0]!.domain_stats?.synthesis as Record<string, unknown>
    expect(synthesis.conclusion).toBe('stub synthesis conclusion')
  })

  it('combined mode produces synthesis and seer votes in the same layer2 chunk', async () => {
    const harness = await bootstrap({ scope: 'combined', readerCount: 3 })
    for (let i = 0; i < 3; i += 1) {
      const deps = harness.deps()
      await advanceOracleSession(harness.session.id, deps)
      await deps.drain()
    }
    const before = (await harness.store.getSession(harness.session.id))!
    expect(before.next_action).toBe('layer2')

    const deps = harness.deps()
    await advanceOracleSession(harness.session.id, deps)
    await deps.drain()

    expect(harness.store.verdicts).toHaveLength(3)
    const synthesis = harness.store.consensus[0]!.domain_stats?.synthesis as Record<string, unknown>
    expect(synthesis.conclusion).toBe('stub synthesis conclusion')
  })

  it('verdict units carry the seer seat brand; witness gets previous only for returning users', async () => {
    const seen: Array<{ unit: string; brand?: string; previous: unknown }> = []
    const recording = (inner: OracleAiAdapter): OracleAiAdapter => ({
      run(request, options) {
        if (request.kind === 'verdict') {
          seen.push({
            unit: request.unit,
            brand: request.brand,
            previous: 'previous' in request.payload ? request.payload.previous : 'ABSENT',
          })
        }
        return inner.run(request, options)
      },
    })

    // First visit: N=9 panel, no prior combined session.
    const harness = await bootstrap({ scope: 'combined', readerCount: 9, ai: recording(fastAi()) })
    const first = await runToCompletion(harness)
    expect(first.status).toBe('done')

    const bySlug = new Map(seen.map((row) => [row.unit, row]))
    expect(bySlug.get('contrarian')?.brand).toBe('ByteDance')
    expect(bySlug.get('elder')?.brand).toBe('NAVER')
    expect(bySlug.get('mystic')?.brand).toBe('Anthropic')
    // Non-witness seers never see the key; first-time witness sees null.
    expect(bySlug.get('reader')?.previous).toBe('ABSENT')
    expect(bySlug.get('witness')?.previous).toBeNull()

    // Second visit, same user + store: witness now compares against the record.
    seen.length = 0
    const again = await createOracleSession(
      USER,
      {
        kind: 'personal',
        subjectProfileId: 'profile-subject',
        scope: 'combined',
        systems: [],
        question: null,
        sessionInputs: PRISM_INPUTS,
        readerCount: 9,
        locale: 'ko',
      },
      { store: harness.store, credits: harness.credits, now: () => NOW, seed: () => 'seed-advance-2' },
    )
    if (!again.ok) throw new Error('second session failed')
    const secondHarness: Harness = { ...harness, session: again.session }
    const second = await runToCompletion(secondHarness, recording(fastAi()))
    expect(second.status).toBe('done')

    const witness = seen.find((row) => row.unit === 'witness')
    expect(witness?.previous).toMatchObject({ completedAt: expect.anything() })
    const previous = witness?.previous as { ballotTally?: { participantCount?: number } }
    expect(previous.ballotTally?.participantCount).toBe(9)
  })
})

describe('finalize', () => {
  it('writes the ballot tally and marks the session done', async () => {
    const harness = await bootstrap()
    const final = await runToCompletion(harness)

    expect(final.status).toBe('done')
    const consensus = harness.store.consensus[0]!
    const tally = consensus.ballot_tally as { participantCount: number; counts: Record<string, number> }
    expect(tally.participantCount).toBe(3)
    expect(Object.values(tally.counts).reduce((sum, n) => sum + n, 0)).toBe(3)
    // Written at create, still present after finalize's partial upsert.
    expect(consensus.deficiency_vector).not.toBeNull()
    expect(consensus.system_agreement).not.toBeNull()
  })
})

describe('poll', () => {
  it('is read-only and costs no credits, even on a finished session', async () => {
    const harness = await bootstrap()
    const final = await runToCompletion(harness)

    const writesBefore = harness.store.writeCount
    const chargesBefore = harness.credits.charges.length

    const view = await readOracleSession(final, harness.store, NOW)
    const again = await readOracleSession(final, harness.store, NOW)

    expect(harness.store.writeCount).toBe(writesBefore)
    expect(harness.credits.charges).toHaveLength(chargesBefore)
    expect(harness.credits.refunds).toHaveLength(0)

    expect(view.status).toBe('done')
    expect(view.readings).toHaveLength(12)
    expect(view.verdicts).toHaveLength(3)
    expect(view.consensus).not.toBeNull()
    expect(view.counts.total).toBe(16)
    expect(view.consensus?.agreements).toEqual(['stub agreement'])
    expect(view.consensus?.divergences).toEqual(['stub divergence'])
    expect(view.consensus?.conclusion).toBe('stub synthesis conclusion')
    expect(view.aiMode).toBe('live')
    expect(again).toEqual(view)
  })

  it('never exposes the server-only model column', async () => {
    const harness = await bootstrap()
    const final = await runToCompletion(harness)
    const view = await readOracleSession(final, harness.store, NOW)

    const serialized = JSON.stringify(view)
    expect(serialized).not.toContain('"model"')
    expect(view.readings.every((row) => !('model' in row))).toBe(true)
    expect(view.verdicts.every((row) => !('model' in row))).toBe(true)
  })
})

describe('global AI-unit cap', () => {
  it('defers the chunk without losing next_action when the gauge is full', async () => {
    const harness = await bootstrap()
    expect(tryAcquireAiSlots(ORACLE_MAX_CONCURRENT_AI_UNITS)).toBe(true)

    const deps = harness.deps()
    const outcome = await advanceOracleSession(harness.session.id, deps)
    await deps.drain()

    expect(outcome.claimed).toBe(true)
    expect(harness.store.readings).toHaveLength(0)

    const session = (await harness.store.getSession(harness.session.id))!
    expect(session.next_action).toBe('layer1')
    // Lease dropped, so the sweeper can retry once the gauge drains.
    expect(session.lease_until).toBeNull()

    releaseAiSlots(ORACLE_MAX_CONCURRENT_AI_UNITS)
    const retry = harness.deps()
    await advanceOracleSession(harness.session.id, retry)
    await retry.drain()
    expect(harness.store.readings).toHaveLength(ORACLE_LAYER1_CHUNK_SIZE)
  })
})

describe('attempt exhaustion', () => {
  it('fails and refunds when nothing was produced', async () => {
    const harness = await bootstrap()
    await harness.store.updateSession(harness.session.id, { attempt_count: ORACLE_MAX_ATTEMPTS })

    const deps = harness.deps()
    await advanceOracleSession(harness.session.id, deps)
    await deps.drain()

    const session = (await harness.store.getSession(harness.session.id))!
    expect(session.status).toBe('failed')
    expect(session.next_action).toBeNull()
    expect(harness.credits.refunds).toEqual([{ userId: USER, amount: session.credits_charged! }])
  })

  it('keeps the session as partial, without a refund, when at least half the systems produced output', async () => {
    const harness = await bootstrap()
    // Two chunks of four readings, then run out of attempts.
    for (let i = 0; i < 2; i++) {
      const deps = harness.deps()
      await advanceOracleSession(harness.session.id, deps)
      await deps.drain()
    }
    expect(harness.store.readings).toHaveLength(8)

    await harness.store.updateSession(harness.session.id, { attempt_count: ORACLE_MAX_ATTEMPTS })
    const deps = harness.deps()
    await advanceOracleSession(harness.session.id, deps)
    await deps.drain()

    const session = (await harness.store.getSession(harness.session.id))!
    expect(session.status).toBe('partial')
    expect(harness.credits.refunds).toHaveLength(0)
  })

  it('does not trip on a healthy five-chunk run', async () => {
    const harness = await bootstrap()
    const final = await runToCompletion(harness)
    expect(final.status).toBe('done')
    expect(final.attempt_count).toBe(0)
  })
})

describe('sweeper', () => {
  it('picks up a session whose worker died and advances it', async () => {
    const harness = await bootstrap()
    const stale = new Date(NOW.getTime() - (ORACLE_STALE_HEARTBEAT_SECONDS + 30) * 1_000)
    await harness.store.updateSession(harness.session.id, {
      last_heartbeat_at: stale.toISOString(),
      lease_until: null,
    })

    const deps = harness.deps()
    const summary = await sweepOracleSessions(deps)
    await deps.drain()

    expect(summary.candidates).toBe(1)
    expect(summary.claimed).toBe(1)
    expect(harness.store.readings).toHaveLength(ORACLE_LAYER1_CHUNK_SIZE)
  })

  it('ignores a session that is still beating', async () => {
    const harness = await bootstrap()
    const summary = await sweepOracleSessions(harness.deps())
    expect(summary.candidates).toBe(0)
  })

  it('ignores a session whose lease is still held', async () => {
    const harness = await bootstrap()
    const stale = new Date(NOW.getTime() - (ORACLE_STALE_HEARTBEAT_SECONDS + 30) * 1_000)
    await harness.store.updateSession(harness.session.id, {
      last_heartbeat_at: stale.toISOString(),
      lease_until: new Date(NOW.getTime() + 60_000).toISOString(),
    })

    const summary = await sweepOracleSessions(harness.deps())
    expect(summary.candidates).toBe(0)
  })
})
