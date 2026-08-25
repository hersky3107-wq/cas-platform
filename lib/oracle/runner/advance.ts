/**
 * One chunk of AI work per call, with a lease so two workers never do it twice.
 *
 * The HTTP handler must NOT hold the connection while AI calls run — that is
 * exactly what breaks when a phone locks its screen mid-reading. So advance:
 *
 *   1. claims the lease (atomic conditional UPDATE)
 *   2. returns the current status right away
 *   3. runs the chunk in the background via `after()`, which the route
 *      supplies as `schedule`
 *
 * State machine (status × next_action) is documented in docs/oracle-runner.md.
 * Note that `next_action='consensus'` is the finalize step: the
 * oracle_job_sessions CHECK constraint predates this runner and allows only
 * compute / layer1 / layer2 / consensus, so 'consensus' carries the meaning
 * the spec called 'finalize'.
 */
import { computeConsensus } from '../axes'
import type { AxisVote } from '../axes/types'
import {
  INTEGRATED_SYNTHESIZER_BRAND,
  resolveSingleSystemRoster,
} from '../ai/family-roster'
import { layer1Entry } from '../ai/registry'
import type {
  OracleComputation,
  OracleJobProgress,
  OracleJobSession,
  OracleNextAction,
  OracleReading,
  OracleSessionStatus,
} from '../schema'
import { ballotTallyJson, tallyBallots } from './ballot'
import { personalDataFrom } from './compute'
import { releaseAiSlots, tryAcquireAiSlots } from './concurrency'
import {
  ORACLE_AI_UNIT_TIMEOUT_MS,
  ORACLE_LAYER1_CHUNK_SIZE,
  ORACLE_LEASE_HEARTBEAT_SECONDS,
  ORACLE_LEASE_SECONDS,
  ORACLE_MAX_ATTEMPTS,
  ORACLE_MAX_CONCURRENT_AI_UNITS,
  ORACLE_TERMINAL_STATUSES,
  readerRosterFor,
  readingScopeForSession,
} from './conventions'
import { buildSynthesisPayload, buildVerdictPayload, type PayloadContext } from './payload'
import {
  markUnitDone,
  markUnitFailed,
  readingUnit,
  SYNTHESIS_UNIT,
  verdictUnit,
} from './progress'
import type {
  CreditsPort,
  JsonObject,
  OracleAiAdapter,
  OracleAiRequest,
  OracleAiResult,
  RunnerClock,
  RunnerStore,
  ScheduleBackground,
} from './types'

export type AdvanceDeps = {
  store: RunnerStore
  credits: CreditsPort
  ai: OracleAiAdapter
  /** Routes pass `after()`; tests pass a collector so the chunk can be awaited. */
  schedule: ScheduleBackground
  now?: RunnerClock
  unitTimeoutMs?: number
}

export type AdvanceOutcome = {
  found: boolean
  sessionId: string
  status: OracleSessionStatus | null
  nextAction: OracleNextAction | null
  progress: OracleJobProgress | null
  /** False when the session is terminal or another worker holds the lease. */
  claimed: boolean
}

function isTerminal(status: OracleSessionStatus): boolean {
  return (ORACLE_TERMINAL_STATUSES as readonly OracleSessionStatus[]).includes(status)
}

function describe(session: OracleJobSession, claimed: boolean): AdvanceOutcome {
  return {
    found: true,
    sessionId: session.id,
    status: session.status,
    nextAction: session.next_action,
    progress: session.progress,
    claimed,
  }
}

/**
 * Claims the lease and hands the chunk to the background. Returns as soon as
 * the claim resolves; the caller must not await the chunk.
 */
export async function advanceOracleSession(sessionId: string, deps: AdvanceDeps): Promise<AdvanceOutcome> {
  const now = deps.now ?? (() => new Date())
  const current = await deps.store.getSession(sessionId)
  if (!current) {
    return { found: false, sessionId, status: null, nextAction: null, progress: null, claimed: false }
  }
  if (isTerminal(current.status)) return describe(current, false)

  const at = now()
  const leaseUntil = new Date(at.getTime() + ORACLE_LEASE_SECONDS * 1_000).toISOString()
  const claimed = await deps.store.claimLease(sessionId, leaseUntil, at.toISOString())
  if (!claimed) {
    // Someone else is already working on this. Report status, do nothing.
    return describe(current, false)
  }

  deps.schedule(() => runOracleChunk(claimed, deps))
  return describe(claimed, true)
}

/**
 * Renew lease + heartbeat while parallel AI units run. Without this, a chunk
 * whose units finish near the deadline can lose its lease during the sequential
 * inserts that follow Promise.all, and the sweeper may re-run the chunk.
 */
async function runParallelWithLeaseHeartbeat<T>(
  sessionId: string,
  deps: AdvanceDeps,
  now: RunnerClock,
  work: () => Promise<T>,
): Promise<T> {
  const intervalMs = ORACLE_LEASE_HEARTBEAT_SECONDS * 1_000
  const refresh = (): void => {
    const at = now()
    void deps.store.updateSession(sessionId, {
      last_heartbeat_at: at.toISOString(),
      lease_until: new Date(at.getTime() + ORACLE_LEASE_SECONDS * 1_000).toISOString(),
    })
  }
  const timer = setInterval(refresh, intervalMs)
  try {
    return await work()
  } finally {
    clearInterval(timer)
  }
}

/** Per-unit deadline. A hung adapter loses the race and the unit becomes a 결번. */
async function runAiUnit(deps: AdvanceDeps, request: OracleAiRequest): Promise<OracleAiResult> {
  const timeoutMs = deps.unitTimeoutMs ?? ORACLE_AI_UNIT_TIMEOUT_MS
  const startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined

  const deadline = new Promise<OracleAiResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        ok: false,
        brand: 'unknown',
        model: 'unknown',
        status: 'timeout',
        message: `unit exceeded ${timeoutMs}ms`,
        latencyMs: Date.now() - startedAt,
      })
    }, timeoutMs)
  })

  try {
    return await Promise.race([deps.ai.run(request, { timeoutMs }), deadline])
  } catch (e) {
    return {
      ok: false,
      brand: 'unknown',
      model: 'unknown',
      status: 'error',
      message: e instanceof Error ? e.message : 'adapter threw',
      latencyMs: Date.now() - startedAt,
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * oracle_computations.axes holds the AxisVote the projector produced. It is
 * read back verbatim, so the stored jsonb is the vote.
 */
function votesFromComputations(computations: readonly OracleComputation[]): AxisVote[] {
  return computations
    .filter((row): row is OracleComputation & { axes: JsonObject } => row.axes !== null)
    .map((row) => row.axes as unknown as AxisVote)
}

function payloadContextFor(session: OracleJobSession): PayloadContext {
  const question = session.question_raw
  return {
    kind: session.kind,
    locale: session.locale ?? 'ko',
    readingScope: readingScopeForSession(session.kind, question !== null),
    // asOfDate is only carried for prompt context; the vectors were already
    // anchored at create time.
    asOfDate: session.created_at.slice(0, 10),
    question,
  }
}

function rosterFor(session: OracleJobSession): string[] {
  return session.reader_roster.length > 0 ? session.reader_roster : readerRosterFor(session.reader_count)
}

/** Runs one chunk. Always releases the lease, even on an unexpected throw. */
export async function runOracleChunk(session: OracleJobSession, deps: AdvanceDeps): Promise<void> {
  const now = deps.now ?? (() => new Date())
  try {
    if (session.attempt_count > ORACLE_MAX_ATTEMPTS) {
      await closeOutExhausted(session, deps, now)
      return
    }

    switch (session.next_action) {
      case 'layer1':
        await runLayer1Chunk(session, deps, now)
        return
      case 'layer2':
        await runLayer2Chunk(session, deps, now)
        return
      case 'consensus':
        await finalizeSession(session, deps, now)
        return
      case 'compute':
        // The create request died between inserting the row and computing.
        // Compute is not resumable without the request context, so close it out.
        await failUnresumableCompute(session, deps, now)
        return
      case null:
        await deps.store.updateSession(session.id, { lease_until: null })
        return
    }
  } catch {
    // Drop the lease without refreshing the heartbeat, so the sweeper can
    // pick this up on its next pass rather than a minute later.
    await deps.store.updateSession(session.id, { lease_until: null })
  }
}

async function runLayer1Chunk(session: OracleJobSession, deps: AdvanceDeps, now: RunnerClock): Promise<void> {
  const [computations, readings] = await Promise.all([
    deps.store.listComputations(session.id),
    deps.store.listReadings(session.id),
  ])

  const readable = computations.filter((row) => row.axes !== null)
  const alreadyRead = new Set(readings.map((row) => `${row.system}:${row.brand}`))
  const seats =
    session.scope === 'single'
      ? readable.flatMap((computation) =>
          session.reader_roster.map((brand) => ({ computation, brand })),
        )
      : readable.map((computation) => {
          const brand = layer1Entry(computation.system)?.brand
          if (!brand) throw new Error(`missing integrated reader brand for ${computation.system}`)
          return { computation, brand }
        })
  // Combined remains exactly one seat per system; single expands one system to N brands.
  const outstanding = seats.filter(
    ({ computation, brand }) => !alreadyRead.has(`${computation.system}:${brand}`),
  )
  const chunk = outstanding.slice(0, ORACLE_LAYER1_CHUNK_SIZE)

  if (chunk.length === 0) {
    await deps.store.updateSession(session.id, {
      status: 'layer2',
      next_action: 'layer2',
      lease_until: null,
      last_heartbeat_at: now().toISOString(),
      attempt_count: 0,
    })
    return
  }

  if (!tryAcquireAiSlots(chunk.length)) {
    // Over the cap: no work, next_action untouched, sweeper retries.
    await deps.store.updateSession(session.id, { lease_until: null })
    return
  }

  let progress: OracleJobProgress = session.progress
  let produced = 0

  try {
    const results = await runParallelWithLeaseHeartbeat(session.id, deps, now, () =>
      Promise.all(
        chunk.map(async ({ computation, brand }) => ({
          computation,
          brand,
          result: await runAiUnit(deps, {
            kind: 'reading',
            sessionId: session.id,
            unit: computation.system,
            brand,
            locale: session.locale ?? 'ko',
            seed: session.seed,
            payload: computation.ai_payload ?? {},
          }),
        })),
      ),
    )

    for (const { computation, brand, result } of results) {
      await deps.store.insertReadingIfAbsent({
        session_id: session.id,
        computation_id: computation.id,
        system: computation.system,
        brand,
        model: result.model,
        narrative: result.ok ? result.text : null,
        summary: result.ok ? result.summary : { error: result.message },
        status: result.ok ? 'done' : result.status,
        latency_ms: result.latencyMs,
        tokens_in: result.ok ? result.tokensIn : null,
        tokens_out: result.ok ? result.tokensOut : null,
      })

      const unit = readingUnit(computation.system, brand)
      progress = result.ok ? markUnitDone(progress, unit) : markUnitFailed(progress, unit)
      produced += 1
      // Heartbeat per unit, so the sweeper can tell alive from stuck.
      await deps.store.touchHeartbeat(session.id, now().toISOString())
    }
  } finally {
    releaseAiSlots(chunk.length)
  }

  const allHandled = outstanding.length <= chunk.length
  await deps.store.updateSession(session.id, {
    progress,
    status: allHandled ? 'layer2' : 'layer1',
    next_action: allHandled ? 'layer2' : 'layer1',
    lease_until: null,
    last_heartbeat_at: now().toISOString(),
    // Progress resets the attempt budget; a stalled session keeps its count.
    attempt_count: produced > 0 ? 0 : session.attempt_count,
  })
}

async function runLayer2Chunk(session: OracleJobSession, deps: AdvanceDeps, now: RunnerClock): Promise<void> {
  const seerRoster = session.scope === 'combined' ? rosterFor(session) : []
  const [computations, readings, verdicts, storedConsensus] = await Promise.all([
    deps.store.listComputations(session.id),
    deps.store.listReadings(session.id),
    deps.store.listVerdicts(session.id),
    deps.store.getConsensus(session.id),
  ])

  const alreadyVoted = new Set(verdicts.map((row) => row.reader_slug))
  const allMissingSeers = seerRoster.filter((slug) => !alreadyVoted.has(slug))
  const existingSynthesis =
    storedConsensus?.domain_stats &&
    typeof storedConsensus.domain_stats.synthesis === 'object' &&
    storedConsensus.domain_stats.synthesis !== null
      ? storedConsensus.domain_stats.synthesis as JsonObject
      : null
  const needsSynthesis = existingSynthesis === null
  const missingSeers = allMissingSeers.slice(
    0,
    ORACLE_MAX_CONCURRENT_AI_UNITS - (needsSynthesis ? 1 : 0),
  )

  if (!needsSynthesis && allMissingSeers.length === 0) {
    await deps.store.updateSession(session.id, {
      next_action: 'consensus',
      lease_until: null,
      last_heartbeat_at: now().toISOString(),
      attempt_count: 0,
    })
    return
  }

  const unitCount = missingSeers.length + (needsSynthesis ? 1 : 0)
  if (!tryAcquireAiSlots(unitCount)) {
    await deps.store.updateSession(session.id, { lease_until: null })
    return
  }

  let progress: OracleJobProgress = session.progress
  let produced = 0

  try {
    const profileIds = [
      session.subject_profile_id,
      ...(session.partner_profile_id ? [session.partner_profile_id] : []),
    ]
    const profiles = await deps.store.loadProfiles(session.user_id, profileIds)
    const pii = personalDataFrom(profiles)
    const ctx = payloadContextFor(session)
    const consensus = computeConsensus(votesFromComputations(computations), { readingScope: ctx.readingScope })
    const done: OracleReading[] = readings.filter((row) => row.status === 'done')

    const synthesisBrand =
      session.scope === 'single'
        ? resolveSingleSystemRoster(
            session.systems[0] as Parameters<typeof resolveSingleSystemRoster>[0],
            session.reader_count,
          ).synthesizer
        : INTEGRATED_SYNTHESIZER_BRAND
    const synthesisPromise = needsSynthesis
      ? runAiUnit(deps, {
          kind: 'synthesis',
          sessionId: session.id,
          unit: 'synthesis',
          brand: synthesisBrand,
          locale: ctx.locale,
          seed: session.seed,
          payload: buildSynthesisPayload(done, consensus, pii),
        })
      : null

    const verdictPromises = missingSeers.map(async (slug) => {
        const payload = buildVerdictPayload(
          {
            readerSlug: slug,
            readerIndex: seerRoster.indexOf(slug) + 1,
            readerCount: seerRoster.length,
            consensus,
            readings: done,
          },
          ctx,
          pii,
        )
        return {
          slug,
          result: await runAiUnit(deps, {
            kind: 'verdict',
            sessionId: session.id,
            unit: slug,
            locale: ctx.locale,
            seed: session.seed,
            payload,
          }),
        }
      })
    const [synthesisResult, results] = await Promise.all([
      synthesisPromise,
      Promise.all(verdictPromises),
    ])

    if (synthesisResult) {
      if (synthesisResult.ok && synthesisResult.summary) {
        const synthesis = {
          agreements: synthesisResult.summary.agreements,
          divergences: synthesisResult.summary.divergences,
          conclusion: synthesisResult.summary.conclusion,
          confidence_note: synthesisResult.summary.confidence_note,
        }
        await deps.store.upsertConsensus({
          session_id: session.id,
          domain_stats: {
            ...(storedConsensus?.domain_stats ?? {}),
            synthesis,
          },
        })
        progress = markUnitDone(progress, SYNTHESIS_UNIT)
      } else {
        progress = markUnitFailed(progress, SYNTHESIS_UNIT)
      }
      produced += 1
      await deps.store.touchHeartbeat(session.id, now().toISOString())
    }

    for (const { slug, result } of results) {
      const summary = result.ok ? (result.summary ?? {}) : {}
      const ballot = (summary.ballot ?? null) as JsonObject | null
      const dissent = typeof summary.dissent === 'string' ? summary.dissent : null

      await deps.store.insertVerdictIfAbsent({
        session_id: session.id,
        reader_slug: slug,
        brand: result.brand,
        model: result.model,
        verdict_line: result.ok ? result.text.slice(0, 400) : null,
        ballot,
        dissent,
        full_text: result.ok ? result.text : null,
        status: result.ok ? 'done' : result.status,
        latency_ms: result.latencyMs,
        tokens_in: result.ok ? result.tokensIn : null,
        tokens_out: result.ok ? result.tokensOut : null,
      })

      const unit = verdictUnit(slug)
      progress = result.ok ? markUnitDone(progress, unit) : markUnitFailed(progress, unit)
      produced += 1
      await deps.store.touchHeartbeat(session.id, now().toISOString())
    }
  } finally {
    releaseAiSlots(unitCount)
  }

  await deps.store.updateSession(session.id, {
    progress,
    status: 'layer2',
    next_action: 'consensus',
    lease_until: null,
    last_heartbeat_at: now().toISOString(),
    attempt_count: produced > 0 ? 0 : session.attempt_count,
  })
}

async function finalizeSession(session: OracleJobSession, deps: AdvanceDeps, now: RunnerClock): Promise<void> {
  const [computations, readings, verdicts, existing] = await Promise.all([
    deps.store.listComputations(session.id),
    deps.store.listReadings(session.id),
    deps.store.listVerdicts(session.id),
    deps.store.getConsensus(session.id),
  ])

  const tally = tallyBallots(verdicts)
  const readable = computations.filter((row) => row.axes !== null).length
  const readingsDone = readings.filter((row) => row.status === 'done').length

  await deps.store.upsertConsensus({
    session_id: session.id,
    ballot_tally: ballotTallyJson(tally),
    unanimous: tally.unanimous,
    domain_stats: {
      ...(existing?.domain_stats ?? {}),
      units: {
        systemsRequested: computations.length,
        systemsReadable: readable,
        readingsDone,
        readingsMissing: readable - readingsDone,
        verdictsDone: verdicts.filter((row) => row.status === 'done').length,
        verdictsMissing: verdicts.filter((row) => row.status !== 'done').length,
      },
    },
  })

  // A 결번 does not fail the session: a missing system is a blank seat.
  await deps.store.updateSession(session.id, {
    status: 'done',
    next_action: null,
    completed_at: now().toISOString(),
    lease_until: null,
    last_heartbeat_at: now().toISOString(),
    attempt_count: 0,
  })
}

/**
 * Out of attempts. 'partial' when at least half the readable systems
 * produced a reading — the user has something worth showing — otherwise
 * 'failed' and the credits go back.
 */
async function closeOutExhausted(session: OracleJobSession, deps: AdvanceDeps, now: RunnerClock): Promise<void> {
  const [computations, readings] = await Promise.all([
    deps.store.listComputations(session.id),
    deps.store.listReadings(session.id),
  ])

  const readable = computations.filter((row) => row.axes !== null).length
  const produced = readings.filter((row) => row.status === 'done').length
  const salvageable = readable > 0 && produced * 2 >= readable

  if (!salvageable && session.credits_charged) {
    await deps.credits.refund(session.user_id, session.credits_charged)
  }

  await deps.store.updateSession(session.id, {
    status: salvageable ? 'partial' : 'failed',
    next_action: null,
    completed_at: now().toISOString(),
    lease_until: null,
    last_heartbeat_at: now().toISOString(),
  })
}

async function failUnresumableCompute(
  session: OracleJobSession,
  deps: AdvanceDeps,
  now: RunnerClock,
): Promise<void> {
  if (session.credits_charged) {
    await deps.credits.refund(session.user_id, session.credits_charged)
  }
  await deps.store.updateSession(session.id, {
    status: 'failed',
    next_action: null,
    completed_at: now().toISOString(),
    lease_until: null,
  })
}
