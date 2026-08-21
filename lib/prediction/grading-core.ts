/**
 * AI Prediction League — GRADING ENGINE (pure; all I/O injected).
 *
 * WHAT MAKES A TRACK RECORD WORTH ANYTHING: nobody, including the operator, can
 * choose what gets graded. So this module exposes exactly TWO verbs, and neither
 * takes a selector:
 *
 *   gradeAllDueRounds()      — every due, ungraded round. No limit, no category,
 *                              no round list, no force flag. Nothing to pass.
 *   gradeRoundOnRead(id)     — the round a reader just opened, and ONLY if it is
 *                              due and ungraded. An already-graded round is
 *                              REJECTED ('already_graded'); it is not re-graded,
 *                              not overwritten, not "refreshed".
 *
 * There is deliberately no third verb. Re-grading is not a feature that exists
 * in a degraded form somewhere — the shape of this API is the guarantee.
 *
 * DOUBLE-GRADE SAFETY has two independent layers:
 *   1. the CLAIM (`store.claim`) — a conditional update that only one caller can
 *      win, same lease pattern as `league_deep_runs.busy_until`;
 *   2. the WRITE (`store.saveGraded`) — conditioned on the round still being
 *      ungraded, so even a claim that outlived its lease cannot overwrite a
 *      grade someone else already wrote.
 *
 * The grading DECISION itself is not here — it is `resolveRoundOutcome` in
 * `./resolution.ts`. This module only decides WHEN a round may be graded, and
 * records the answer.
 */

import {
  addUtcDays,
  precheckResolutionWindow,
  resolveRoundOutcome,
  toUtcDate,
  type ResolutionDirection,
  type ResolvedOutcome,
  type RoundResolutionInput,
  type SeriesResult,
  type UnresolvableReason,
} from './resolution'
import { GRADING_CLAIM_MS, gradingStateOf, isReadCooldownActive, type GradingState } from './grading-state'

/**
 * Upper bound on rounds examined in ONE sweep — a runtime guard so a single
 * request cannot run unbounded, NOT a batch size an operator may tune. When the
 * scan fills up, the report says `truncated: true`; the next sweep continues
 * with what is left. Never exposed as a parameter.
 */
export const GRADING_SWEEP_SCAN_CAP = 500

/** The round fields the trigger layer reads. Grading inputs come from `./resolution.ts`. */
export type GradingRoundRecord = {
  id: string
  instrument: string
  category: string
  resolves_at: string
  anchor_price: number | null
  anchor_price_at: string | null
  actual_outcome: string | null
  resolved_at: string | null
  grading_busy_until: string | null
  grading_attempted_at: string | null
  unresolvable_reason: string | null
}

/** Why a grading attempt was refused BEFORE any price data was considered. */
export type GradingRejection =
  /** No such round. */
  | 'not_found'
  /** Already graded. The record is immutable; this is the re-grade refusal. */
  | 'already_graded'
  /** `resolves_at` has not passed yet. */
  | 'not_due'
  /** Another reader/sweep holds the claim right now. */
  | 'claim_held'
  /** Read path only: attempted too recently (see GRADING_READ_COOLDOWN_MS). */
  | 'retry_cooldown'

export type RoundGradingResult =
  | {
      outcome: 'graded'
      roundId: string
      instrument: string
      direction: ResolutionDirection
      resolutionPrice: number
      resolutionSessionDate: string
      childrenGraded: number
    }
  | { outcome: 'unresolvable'; roundId: string; instrument: string; reason: UnresolvableReason; detail: string }
  | { outcome: 'rejected'; roundId: string; instrument: string | null; reason: GradingRejection; state: GradingState | null }
  | { outcome: 'error'; roundId: string; instrument: string; error: string }

export type GradingSweepReport = {
  scanned: number
  graded: number
  unresolvable: number
  rejected: number
  failed: number
  childrenGraded: number
  /** How many price-series calls the pass made (one per distinct instrument, not per round). */
  seriesCalls: number
  /** True when the scan hit GRADING_SWEEP_SCAN_CAP — run it again to finish. */
  truncated: boolean
  rounds: RoundGradingResult[]
  startedAt: string
  finishedAt: string
}

/**
 * Persistence contract. Every method is expected to be safe under concurrency;
 * `claim` in particular MUST be a single conditional update (not read-then-write).
 */
export type GradingStore = {
  loadRound(roundId: string): Promise<GradingRoundRecord | null>
  /** Due + ungraded, oldest deadline first, at most `cap` rows. No other filter. */
  listDueUngraded(cap: number): Promise<GradingRoundRecord[]>
  /**
   * Atomically take the claim. MUST only succeed when the round is still
   * ungraded, already due, and holds no live lease — returning null otherwise.
   */
  claim(roundId: string, leaseUntilIso: string, nowIso: string): Promise<GradingRoundRecord | null>
  /** Writes the grade + its audit pair, conditioned on the round still being ungraded. */
  saveGraded(roundId: string, outcome: ResolvedOutcome, nowIso: string): Promise<{ ok: true } | { ok: false; error: string }>
  /** Records the refusal and releases the claim. */
  saveUnresolvable(roundId: string, reason: UnresolvableReason, detail: string, nowIso: string): Promise<void>
  /** Releases the claim without recording anything (transient failure). */
  releaseClaim(roundId: string): Promise<void>
  /** Grades the round's up/down children. Returns how many rows were graded. */
  gradeChildren(roundId: string, direction: ResolutionDirection): Promise<number>
}

export type GradingDeps = {
  store: GradingStore
  /** Daily closes, inclusive of `startDate`, for one instrument. */
  fetchSeries: (instrument: string, startDate: string, endDate: string) => Promise<SeriesResult>
  /** False for handles with no price symbol (e.g. 'MATCH:…') — refused without a feed call. */
  isPriceInstrument: (instrument: string) => boolean
  now?: () => Date
}

function toResolutionInput(round: GradingRoundRecord): RoundResolutionInput {
  return {
    instrument: round.instrument,
    anchorPrice: round.anchor_price,
    anchorPriceAt: round.anchor_price_at,
    resolvesAt: round.resolves_at,
  }
}

/**
 * The series window for one round: from the anchor's UTC day through one day
 * PAST the deadline's UTC day (headroom so the deadline day's bar is always in
 * the response — bars past the deadline are discarded by the window rule in
 * `resolveRoundOutcome`). Null when the round has no usable window.
 */
function seriesWindowFor(round: GradingRoundRecord): { start: string; end: string } | null {
  if (!round.anchor_price_at) return null
  const anchorMs = Date.parse(round.anchor_price_at)
  const resolvesMs = Date.parse(round.resolves_at)
  if (!Number.isFinite(anchorMs) || !Number.isFinite(resolvesMs)) return null
  return { start: toUtcDate(anchorMs), end: addUtcDays(toUtcDate(resolvesMs), 1) }
}

/**
 * BATCHING: one series call per distinct instrument, covering the union of that
 * instrument's round windows. Each round is still resolved against its OWN
 * window inside `resolveRoundOutcome`, so sharing the response cannot leak one
 * round's session into another's grade.
 */
export function planSeriesFetches(
  rounds: readonly GradingRoundRecord[],
  isPriceInstrument: (instrument: string) => boolean
): Map<string, { start: string; end: string }> {
  const plan = new Map<string, { start: string; end: string }>()
  for (const round of rounds) {
    if (!isPriceInstrument(round.instrument)) continue
    const window = seriesWindowFor(round)
    if (!window) continue
    const existing = plan.get(round.instrument)
    if (!existing) {
      plan.set(round.instrument, { ...window })
      continue
    }
    if (window.start < existing.start) existing.start = window.start
    if (window.end > existing.end) existing.end = window.end
  }
  return plan
}

export function createGradingEngine(deps: GradingDeps) {
  const nowDate = deps.now ?? (() => new Date())

  function rejected(
    roundId: string,
    instrument: string | null,
    reason: GradingRejection,
    state: GradingState | null
  ): RoundGradingResult {
    return { outcome: 'rejected', roundId, instrument, reason, state }
  }

  async function recordUnresolvable(
    round: GradingRoundRecord,
    reason: UnresolvableReason,
    detail: string
  ): Promise<RoundGradingResult> {
    await deps.store.saveUnresolvable(round.id, reason, detail, nowDate().toISOString())
    return { outcome: 'unresolvable', roundId: round.id, instrument: round.instrument, reason, detail }
  }

  /**
   * Grades a round the caller has ALREADY claimed. `prefetched` is the sweep's
   * shared per-instrument series; the single-round path passes null and fetches
   * its own.
   */
  async function gradeClaimedRound(
    round: GradingRoundRecord,
    prefetched: SeriesResult | null
  ): Promise<RoundGradingResult> {
    const input = toResolutionInput(round)

    if (!deps.isPriceInstrument(round.instrument)) {
      return recordUnresolvable(round, 'not_price_instrument', `${round.instrument} has no price symbol mapping`)
    }

    // Refuse before spending a feed credit on a round that can never be graded.
    const precheck = precheckResolutionWindow(input)
    if (precheck) return recordUnresolvable(round, precheck.reason, precheck.detail)

    let series = prefetched
    if (!series) {
      const window = seriesWindowFor(round)
      if (!window) return recordUnresolvable(round, 'invalid_window', `unusable series window for round ${round.id}`)
      series = await deps.fetchSeries(round.instrument, window.start, window.end)
    }

    const resolution = resolveRoundOutcome({ ...input, series })
    if (!resolution.ok) return recordUnresolvable(round, resolution.reason, resolution.detail)

    // Stamp children BEFORE marking the round graded. saveGraded writes
    // actual_outcome, which flips gradingState to 'graded' and stops the
    // card's poll. Doing that first is how three directional tiles rendered
    // with no 적중/실패 stamp: the client saw a graded round mid-loop.
    const childrenGraded = await deps.store.gradeChildren(round.id, resolution.outcome.actualDirection)
    const saved = await deps.store.saveGraded(round.id, resolution.outcome, nowDate().toISOString())
    if (!saved.ok) {
      await deps.store.releaseClaim(round.id)
      return { outcome: 'error', roundId: round.id, instrument: round.instrument, error: saved.error }
    }

    return {
      outcome: 'graded',
      roundId: round.id,
      instrument: round.instrument,
      direction: resolution.outcome.actualDirection,
      resolutionPrice: resolution.outcome.resolutionPrice,
      resolutionSessionDate: resolution.outcome.resolutionSessionDate,
      childrenGraded,
    }
  }

  async function claim(round: GradingRoundRecord): Promise<GradingRoundRecord | null> {
    const now = nowDate()
    return deps.store.claim(round.id, new Date(now.getTime() + GRADING_CLAIM_MS).toISOString(), now.toISOString())
  }

  /** Distinguishes "someone else is grading it" from "someone else just graded it". */
  async function classifyLostClaim(round: GradingRoundRecord): Promise<RoundGradingResult> {
    const fresh = (await deps.store.loadRound(round.id)) ?? round
    const state = gradingStateOf(fresh, nowDate().getTime())
    return rejected(round.id, round.instrument, state === 'graded' ? 'already_graded' : 'claim_held', state)
  }

  async function guarded(round: GradingRoundRecord, run: () => Promise<RoundGradingResult>): Promise<RoundGradingResult> {
    try {
      return await run()
    } catch (e: unknown) {
      await deps.store.releaseClaim(round.id).catch(() => {})
      return {
        outcome: 'error',
        roundId: round.id,
        instrument: round.instrument,
        error: e instanceof Error ? e.message : 'unknown grading error',
      }
    }
  }

  /**
   * GRADE-ON-READ. Takes the round the reader opened — never a list, never a
   * filter — and grades it only if it is due and ungraded. Already-graded rounds
   * are rejected here rather than re-graded, and the claim makes concurrent
   * readers safe: exactly one wins, the rest are told 'claim_held'.
   */
  async function gradeRoundOnRead(roundId: string): Promise<RoundGradingResult> {
    const round = await deps.store.loadRound(roundId)
    if (!round) return rejected(roundId, null, 'not_found', null)

    const state = gradingStateOf(round, nowDate().getTime())
    if (state === 'graded') return rejected(round.id, round.instrument, 'already_graded', state)
    if (state === 'not_due') return rejected(round.id, round.instrument, 'not_due', state)
    if (state === 'grading') return rejected(round.id, round.instrument, 'claim_held', state)
    if (isReadCooldownActive(round, nowDate().getTime())) {
      return rejected(round.id, round.instrument, 'retry_cooldown', state)
    }

    const claimed = await claim(round)
    if (!claimed) return classifyLostClaim(round)
    return guarded(claimed, () => gradeClaimedRound(claimed, null))
  }

  /**
   * ADMIN SWEEP. Grades EVERY due, ungraded round it can see, in deadline order,
   * with one price-series call per instrument. No parameters: there is nothing an
   * operator can narrow, skip, or re-run. Rounds already graded are never
   * revisited (they are not in the scan, and the claim would refuse them anyway).
   */
  async function gradeAllDueRounds(): Promise<GradingSweepReport> {
    const startedAt = nowDate().toISOString()
    const due = await deps.store.listDueUngraded(GRADING_SWEEP_SCAN_CAP)

    const plan = planSeriesFetches(due, deps.isPriceInstrument)
    const series = new Map<string, SeriesResult>()
    for (const [instrument, window] of plan) {
      try {
        series.set(instrument, await deps.fetchSeries(instrument, window.start, window.end))
      } catch (e: unknown) {
        series.set(instrument, { ok: false, error: e instanceof Error ? e.message : 'series fetch threw' })
      }
    }

    const rounds: RoundGradingResult[] = []
    for (const round of due) {
      const claimed = await claim(round)
      if (!claimed) {
        rounds.push(await classifyLostClaim(round))
        continue
      }
      rounds.push(await guarded(claimed, () => gradeClaimedRound(claimed, series.get(claimed.instrument) ?? null)))
    }

    return {
      scanned: due.length,
      graded: rounds.filter((r) => r.outcome === 'graded').length,
      unresolvable: rounds.filter((r) => r.outcome === 'unresolvable').length,
      rejected: rounds.filter((r) => r.outcome === 'rejected').length,
      failed: rounds.filter((r) => r.outcome === 'error').length,
      childrenGraded: rounds.reduce((sum, r) => sum + (r.outcome === 'graded' ? r.childrenGraded : 0), 0),
      seriesCalls: series.size,
      truncated: due.length >= GRADING_SWEEP_SCAN_CAP,
      rounds,
      startedAt,
      finishedAt: nowDate().toISOString(),
    }
  }

  return { gradeRoundOnRead, gradeAllDueRounds }
}

export type GradingEngine = ReturnType<typeof createGradingEngine>
