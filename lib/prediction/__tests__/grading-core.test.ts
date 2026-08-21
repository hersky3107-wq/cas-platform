import { describe, expect, it } from 'vitest'
import {
  createGradingEngine,
  planSeriesFetches,
  type GradingRoundRecord,
  type GradingStore,
} from '../grading-core'
import { GRADING_READ_COOLDOWN_MS } from '../grading-state'
import type { DailyBar, ResolvedOutcome, SeriesResult } from '../resolution'

/**
 * Grading TRIGGER tests. The grading DECISION is covered by
 * `resolution.test.ts`; what matters here is that nothing can be graded twice,
 * nothing that is already graded can be graded again, and that a pass grades
 * everything it can see rather than a chosen subset.
 */

const NOW_ISO = '2026-08-20T12:00:00.000Z'
const NOW = Date.parse(NOW_ISO)

/** Gradeable: anchor observed Aug 18, deadline Aug 19 12:00 → the Aug 18 close decides it. */
function dueRound(overrides: Partial<GradingRoundRecord> = {}): GradingRoundRecord {
  return {
    id: 'round-a',
    instrument: 'AAPL',
    category: 'stock',
    resolves_at: '2026-08-19T12:00:00.000Z',
    anchor_price: 100,
    anchor_price_at: '2026-08-18T03:00:00.000Z',
    actual_outcome: null,
    resolved_at: null,
    grading_busy_until: null,
    grading_attempted_at: null,
    unresolvable_reason: null,
    ...overrides,
  }
}

const AAPL_BARS: DailyBar[] = [
  { sessionDate: '2026-08-17', close: 100 },
  { sessionDate: '2026-08-18', close: 105 },
  { sessionDate: '2026-08-19', close: 90 },
]

type FakeStore = GradingStore & {
  rows: Map<string, GradingRoundRecord>
  calls: {
    claims: number
    saveGraded: number
    saveUnresolvable: number
    releaseClaim: number
    gradeChildren: number
  }
  gradedWith: { roundId: string; outcome: ResolvedOutcome }[]
  unresolvableWith: { roundId: string; reason: string; detail: string }[]
}

/**
 * In-memory stand-in for the service-role store. `claim` does its check and its
 * write with NO await in between, which is exactly the atomicity the real store
 * gets from a single conditional UPDATE — that is what makes the concurrency
 * test below meaningful rather than a formality.
 */
function createFakeStore(
  rows: GradingRoundRecord[],
  opts: { failSaveGraded?: boolean; yieldOnLoad?: boolean } = {}
): FakeStore {
  const map = new Map(rows.map((r) => [r.id, { ...r }]))
  const calls = { claims: 0, saveGraded: 0, saveUnresolvable: 0, releaseClaim: 0, gradeChildren: 0 }
  const gradedWith: { roundId: string; outcome: ResolvedOutcome }[] = []
  const unresolvableWith: { roundId: string; reason: string; detail: string }[] = []

  return {
    rows: map,
    calls,
    gradedWith,
    unresolvableWith,

    async loadRound(roundId) {
      if (opts.yieldOnLoad) await Promise.resolve()
      const row = map.get(roundId)
      return row ? { ...row } : null
    },

    async listDueUngraded(cap) {
      return [...map.values()]
        .filter((r) => r.actual_outcome === null && Date.parse(r.resolves_at) < NOW)
        .sort((a, b) => a.resolves_at.localeCompare(b.resolves_at))
        .slice(0, cap)
        .map((r) => ({ ...r }))
    },

    async claim(roundId, leaseUntilIso, nowIso) {
      const row = map.get(roundId)
      if (!row) return null
      if (row.actual_outcome !== null) return null
      if (Date.parse(row.resolves_at) >= Date.parse(nowIso)) return null
      if (row.grading_busy_until && Date.parse(row.grading_busy_until) >= Date.parse(nowIso)) return null
      row.grading_busy_until = leaseUntilIso
      row.grading_attempted_at = nowIso
      calls.claims += 1
      return { ...row }
    },

    async saveGraded(roundId, outcome, nowIso) {
      calls.saveGraded += 1
      if (opts.failSaveGraded) return { ok: false, error: 'round was graded by another pass' }
      const row = map.get(roundId)
      if (!row || row.actual_outcome !== null) return { ok: false, error: 'round was graded by another pass' }
      row.actual_outcome = outcome.rawOutcome
      row.resolved_at = nowIso
      row.unresolvable_reason = null
      row.grading_busy_until = null
      gradedWith.push({ roundId, outcome })
      return { ok: true }
    },

    async saveUnresolvable(roundId, reason, detail) {
      calls.saveUnresolvable += 1
      const row = map.get(roundId)
      if (row) {
        row.unresolvable_reason = reason
        row.grading_busy_until = null
      }
      unresolvableWith.push({ roundId, reason, detail })
    },

    async releaseClaim(roundId) {
      calls.releaseClaim += 1
      const row = map.get(roundId)
      if (row) row.grading_busy_until = null
    },

    async gradeChildren() {
      calls.gradeChildren += 1
      return 40
    },
  }
}

function createFakeSeries(bars: Record<string, DailyBar[]>) {
  const requests: { instrument: string; start: string; end: string }[] = []
  const fetchSeries = async (instrument: string, start: string, end: string): Promise<SeriesResult> => {
    requests.push({ instrument, start, end })
    const found = bars[instrument]
    return found ? { ok: true, bars: found } : { ok: false, error: `no fixture for ${instrument}` }
  }
  return { fetchSeries, requests }
}

function engineFor(store: GradingStore, seriesBars: Record<string, DailyBar[]> = { AAPL: AAPL_BARS }) {
  const series = createFakeSeries(seriesBars)
  const engine = createGradingEngine({
    store,
    fetchSeries: series.fetchSeries,
    isPriceInstrument: (instrument) => !instrument.startsWith('MATCH:'),
    now: () => new Date(NOW),
  })
  return { engine, series }
}

describe('grade-on-read — concurrency', () => {
  it('grades exactly once when several readers open the same due round at the same time', async () => {
    const store = createFakeStore([dueRound()], { yieldOnLoad: true })
    const { engine, series } = engineFor(store)

    const results = await Promise.all([
      engine.gradeRoundOnRead('round-a'),
      engine.gradeRoundOnRead('round-a'),
      engine.gradeRoundOnRead('round-a'),
    ])

    expect(results.filter((r) => r.outcome === 'graded')).toHaveLength(1)
    expect(store.calls.claims).toBe(1)
    expect(store.calls.saveGraded).toBe(1)
    expect(store.calls.gradeChildren).toBe(1)
    expect(series.requests).toHaveLength(1)

    // The losers are told why, and none of them wrote anything.
    for (const result of results.filter((r) => r.outcome !== 'graded')) {
      expect(result.outcome).toBe('rejected')
      if (result.outcome !== 'rejected') continue
      expect(['claim_held', 'already_graded']).toContain(result.reason)
    }
  })

  it('refuses a reader while another grader holds the lease', async () => {
    const store = createFakeStore([dueRound({ grading_busy_until: '2026-08-20T12:01:00.000Z' })])
    const { engine, series } = engineFor(store)

    const result = await engine.gradeRoundOnRead('round-a')
    expect(result.outcome).toBe('rejected')
    if (result.outcome === 'rejected') expect(result.reason).toBe('claim_held')
    expect(series.requests).toHaveLength(0)
    expect(store.calls.claims).toBe(0)
  })
})

describe('re-grading is refused outright', () => {
  it('rejects a round that is already graded and writes nothing', async () => {
    const store = createFakeStore([
      dueRound({ actual_outcome: 'up (2026-08-18 close 105 vs anchor 100)', resolved_at: '2026-08-19T13:00:00.000Z' }),
    ])
    const { engine, series } = engineFor(store)

    const result = await engine.gradeRoundOnRead('round-a')

    expect(result.outcome).toBe('rejected')
    if (result.outcome === 'rejected') {
      expect(result.reason).toBe('already_graded')
      expect(result.state).toBe('graded')
    }
    expect(store.calls.claims).toBe(0)
    expect(store.calls.saveGraded).toBe(0)
    expect(store.calls.saveUnresolvable).toBe(0)
    expect(series.requests).toHaveLength(0)
    expect(store.rows.get('round-a')?.actual_outcome).toBe('up (2026-08-18 close 105 vs anchor 100)')
  })

  it('leaves a grade written by a racing pass alone even if a claim was somehow held', async () => {
    // Children are stamped first (so a reader never sees a graded round with
    // unstamped tiles). saveGraded then fails the way the real store fails
    // when `actual_outcome` is no longer null: the other pass's outcome
    // stands, this one reports an error and releases the claim.
    const store = createFakeStore([dueRound()], { failSaveGraded: true })
    const { engine } = engineFor(store)

    const result = await engine.gradeRoundOnRead('round-a')

    expect(result.outcome).toBe('error')
    expect(store.calls.gradeChildren).toBe(1)
    expect(store.calls.saveGraded).toBe(1)
    expect(store.calls.releaseClaim).toBe(1)
  })

  it('rejects a round whose deadline has not passed, without touching the price feed', async () => {
    const store = createFakeStore([dueRound({ resolves_at: '2026-08-21T12:00:00.000Z' })])
    const { engine, series } = engineFor(store)

    const result = await engine.gradeRoundOnRead('round-a')
    expect(result.outcome).toBe('rejected')
    if (result.outcome === 'rejected') expect(result.reason).toBe('not_due')
    expect(series.requests).toHaveLength(0)
  })

  it('rejects an unknown round id', async () => {
    const store = createFakeStore([])
    const { engine } = engineFor(store)
    const result = await engine.gradeRoundOnRead('nope')
    expect(result.outcome).toBe('rejected')
    if (result.outcome === 'rejected') expect(result.reason).toBe('not_found')
  })
})

describe('grade-on-read — throttling a round that cannot be graded', () => {
  it('does not re-attempt on every read within the cooldown window', async () => {
    const store = createFakeStore([
      dueRound({
        anchor_price: null,
        anchor_price_at: null,
        unresolvable_reason: 'missing_anchor',
        grading_attempted_at: new Date(NOW - 60_000).toISOString(),
      }),
    ])
    const { engine } = engineFor(store)

    const result = await engine.gradeRoundOnRead('round-a')
    expect(result.outcome).toBe('rejected')
    if (result.outcome === 'rejected') expect(result.reason).toBe('retry_cooldown')
    expect(store.calls.claims).toBe(0)
  })

  it('retries once the cooldown has elapsed', async () => {
    const store = createFakeStore([
      dueRound({
        anchor_price: null,
        anchor_price_at: null,
        unresolvable_reason: 'missing_anchor',
        grading_attempted_at: new Date(NOW - GRADING_READ_COOLDOWN_MS - 1_000).toISOString(),
      }),
    ])
    const { engine, series } = engineFor(store)

    const result = await engine.gradeRoundOnRead('round-a')
    expect(result.outcome).toBe('unresolvable')
    if (result.outcome === 'unresolvable') expect(result.reason).toBe('missing_anchor')
    // No baseline means no feed call — the refusal is free.
    expect(series.requests).toHaveLength(0)
  })
})

describe('sweep — every due round, one series call per instrument', () => {
  const rounds = [
    dueRound({ id: 'aapl-up', instrument: 'AAPL', anchor_price: 100 }),
    dueRound({ id: 'aapl-down', instrument: 'AAPL', anchor_price: 200, resolves_at: '2026-08-19T12:00:01.000Z' }),
    dueRound({ id: 'no-anchor', instrument: 'MSFT', anchor_price: null, anchor_price_at: null }),
    dueRound({ id: 'sports', instrument: 'MATCH:KOR-JPN', category: 'sports' }),
    dueRound({ id: 'not-due', resolves_at: '2026-08-21T12:00:00.000Z' }),
    dueRound({ id: 'already', actual_outcome: 'down (…)', resolved_at: '2026-08-19T13:00:00.000Z' }),
    dueRound({ id: 'tie', instrument: 'TSLA', anchor_price: 105 }),
  ]

  it('grades what it can, refuses the rest with a reason, and skips what is not its business', async () => {
    const store = createFakeStore(rounds)
    const { engine, series } = engineFor(store, { AAPL: AAPL_BARS, TSLA: AAPL_BARS })

    const report = await engine.gradeAllDueRounds()

    // not-due and already-graded rounds are never even scanned.
    expect(report.scanned).toBe(5)
    expect(report.rounds.map((r) => r.roundId)).not.toContain('not-due')
    expect(report.rounds.map((r) => r.roundId)).not.toContain('already')

    expect(report.graded).toBe(2)
    expect(report.childrenGraded).toBe(80)
    expect(report.unresolvable).toBe(3)
    expect(report.failed).toBe(0)
    expect(report.truncated).toBe(false)

    const byId = new Map(report.rounds.map((r) => [r.roundId, r]))
    expect(byId.get('aapl-up')).toMatchObject({ outcome: 'graded', direction: 'up', resolutionPrice: 105 })
    expect(byId.get('aapl-down')).toMatchObject({ outcome: 'graded', direction: 'down', resolutionPrice: 105 })
    expect(byId.get('no-anchor')).toMatchObject({ outcome: 'unresolvable', reason: 'missing_anchor' })
    expect(byId.get('sports')).toMatchObject({ outcome: 'unresolvable', reason: 'not_price_instrument' })
    expect(byId.get('tie')).toMatchObject({ outcome: 'unresolvable', reason: 'equal_close' })

    // BATCHING: two AAPL rounds share ONE call; the sports handle and the
    // anchor-less round cost nothing.
    expect(series.requests.map((r) => r.instrument).sort()).toEqual(['AAPL', 'TSLA'])
    expect(report.seriesCalls).toBe(2)
  })

  it('records the audit pair for every round it grades', async () => {
    const store = createFakeStore(rounds)
    const { engine } = engineFor(store, { AAPL: AAPL_BARS, TSLA: AAPL_BARS })
    await engine.gradeAllDueRounds()

    expect(store.gradedWith.map((g) => g.roundId).sort()).toEqual(['aapl-down', 'aapl-up'])
    for (const { outcome } of store.gradedWith) {
      expect(outcome.resolutionPrice).toBe(105)
      expect(outcome.resolutionSessionDate).toBe('2026-08-18')
      expect(outcome.rawOutcome).toContain('2026-08-18')
    }
  })

  it('finds nothing left to grade on a second pass', async () => {
    const store = createFakeStore(rounds)
    const { engine } = engineFor(store, { AAPL: AAPL_BARS, TSLA: AAPL_BARS })

    await engine.gradeAllDueRounds()
    const second = await engine.gradeAllDueRounds()

    // The two graded rounds are gone from the scan; the unresolvable ones stay
    // visible and are retried (the sweep is not throttled), still refusing.
    expect(second.graded).toBe(0)
    expect(second.scanned).toBe(3)
    expect(second.unresolvable).toBe(3)
  })

  it('reports a feed failure per round instead of grading against nothing', async () => {
    const store = createFakeStore([dueRound({ id: 'aapl-up', instrument: 'AAPL' })])
    const { engine } = engineFor(store, {})

    const report = await engine.gradeAllDueRounds()

    expect(report.graded).toBe(0)
    expect(report.unresolvable).toBe(1)
    expect(report.rounds[0]).toMatchObject({ outcome: 'unresolvable', reason: 'series_unavailable' })
    expect(store.rows.get('aapl-up')?.actual_outcome).toBeNull()
  })

  it('skips a round another grader is holding rather than double-grading it', async () => {
    const store = createFakeStore([
      dueRound({ id: 'held', grading_busy_until: '2026-08-20T12:01:00.000Z' }),
    ])
    const { engine } = engineFor(store)

    const report = await engine.gradeAllDueRounds()

    expect(report.graded).toBe(0)
    expect(report.rejected).toBe(1)
    expect(report.rounds[0]).toMatchObject({ outcome: 'rejected', reason: 'claim_held' })
  })
})

describe('planSeriesFetches', () => {
  it('unions the windows of every round on the same instrument into one request', () => {
    const plan = planSeriesFetches(
      [
        dueRound({ id: 'a', anchor_price_at: '2026-08-10T00:00:00.000Z', resolves_at: '2026-08-11T00:00:00.000Z' }),
        dueRound({ id: 'b', anchor_price_at: '2026-08-18T00:00:00.000Z', resolves_at: '2026-08-19T00:00:00.000Z' }),
      ],
      () => true
    )
    expect(plan.size).toBe(1)
    expect(plan.get('AAPL')).toEqual({ start: '2026-08-10', end: '2026-08-20' })
  })

  it('plans no call for instruments with no price symbol or no usable window', () => {
    const plan = planSeriesFetches(
      [
        dueRound({ id: 'sports', instrument: 'MATCH:KOR-JPN' }),
        dueRound({ id: 'no-anchor', instrument: 'MSFT', anchor_price_at: null }),
      ],
      (instrument) => !instrument.startsWith('MATCH:')
    )
    expect(plan.size).toBe(0)
  })
})
