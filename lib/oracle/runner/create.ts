/**
 * Session create: charge once, compute everything, hand back a session the
 * client can start polling.
 *
 * Everything here happens inside the HTTP request, because the 12-system
 * calculation is ~8ms — there is no reason to make the client wait for a
 * round trip to find out its own chart. The AI work starts on the first
 * advance call.
 *
 * Credit safety: the charge happens before any compute, and every path out
 * of a failed compute refunds it. A refund can only run while the session is
 * being moved to 'failed', and 'failed' is terminal, so it cannot run twice.
 */
import type { AxisConsensus } from '../axes/types'
import type { OracleComputation, OracleJobSession, OracleReaderCount, OracleSessionKind, OracleSessionScope } from '../schema'
import {
  creditsForOracleSession,
  ORACLE_CREDITS_MODULE,
  ORACLE_PROMPT_VERSION,
  readerRosterFor,
  readingScopeForSession,
} from './conventions'
import { OracleComputeError, personalDataFrom, resolveSystems, runComputations } from './compute'
import { initialProgress, markUnitFailed, readingUnit } from './progress'
import { OraclePrivacyError } from './privacy'
import {
  validateSessionInputs,
  type OracleSessionInputs,
} from './session-inputs'
import type { CreditsPort, JsonObject, RunnerClock, RunnerStore, SeedFactory } from './types'

export type CreateSessionRequest = {
  kind: OracleSessionKind
  subjectProfileId: string
  partnerProfileId?: string | null
  scope: OracleSessionScope
  systems: string[]
  question?: string | null
  sessionInputs?: OracleSessionInputs | null
  readerCount: OracleReaderCount
  locale: string
}

export type CreateSessionDeps = {
  store: RunnerStore
  credits: CreditsPort
  now?: RunnerClock
  seed?: SeedFactory
}

/** What the create response exposes per system. `result` and `ai_payload` stay server-side. */
export type PublicComputation = {
  system: string
  engineVersion: string | null
  axes: JsonObject | null
  unreadable: boolean
}

export type CreateSessionFailureCode =
  | 'invalid_input'
  | 'profile_not_found'
  | 'insufficient_credits'
  | 'credits_error'
  | 'compute_failed'

export type CreateSessionOutcome =
  | {
      ok: true
      /** True when the user already had a session in flight and this one was returned instead. */
      reused: boolean
      session: OracleJobSession
      computations: PublicComputation[]
    }
  | {
      ok: false
      code: CreateSessionFailureCode
      message: string
      balance?: number | null
      /** Present when the session row was created and then marked 'failed'. */
      sessionId?: string
    }

function publicComputation(row: OracleComputation): PublicComputation {
  return {
    system: row.system,
    engineVersion: row.engine_version,
    axes: row.axes,
    unreadable: row.axes === null,
  }
}

/** Today's civil date in the subject's own timezone, not the server's. */
export function civilDateIn(date: Date, timeZone: string): string {
  try {
    // en-CA renders as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

function consensusJson(consensus: AxisConsensus): JsonObject {
  return {
    phase: consensus.phase,
    traits: {
      profile: consensus.traits.profile,
      spread: consensus.traits.spread,
      contested: consensus.traits.contested,
      participating: consensus.traits.participating,
      unreadable: consensus.traits.unreadable,
    },
    systemCount: consensus.systemCount,
  }
}

export async function createOracleSession(
  userId: string,
  request: CreateSessionRequest,
  deps: CreateSessionDeps,
): Promise<CreateSessionOutcome> {
  const { store, credits } = deps
  const now = deps.now ?? (() => new Date())
  const makeSeed = deps.seed ?? (() => crypto.randomUUID())

  // Validate per-session state before active-session lookup, profile I/O, or
  // any credit charge. Direct callers get the same guarantee as the route.
  const sessionInputs = validateSessionInputs(request.sessionInputs)
  if (!sessionInputs.ok) {
    return { ok: false, code: 'invalid_input', message: sessionInputs.error }
  }

  // 1. One active session per user. A second create returns the first.
  const active = await store.findActiveSession(userId)
  if (active) {
    const existing = await store.listComputations(active.id)
    return { ok: true, reused: true, session: active, computations: existing.map(publicComputation) }
  }

  // 2. Ownership. loadProfiles only returns rows owned by this user, so a
  //    foreign or unknown id is indistinguishable from a missing one.
  const wantedIds = [request.subjectProfileId, ...(request.partnerProfileId ? [request.partnerProfileId] : [])]
  const profiles = await store.loadProfiles(userId, wantedIds)
  const subject = profiles.find((row) => row.id === request.subjectProfileId)
  if (!subject) {
    return { ok: false, code: 'profile_not_found', message: 'subject profile not found' }
  }
  if (request.partnerProfileId && !profiles.some((row) => row.id === request.partnerProfileId)) {
    return { ok: false, code: 'profile_not_found', message: 'partner profile not found' }
  }

  // 3. Charge once, before any work.
  const cost = creditsForOracleSession(request.kind, request.readerCount)
  const charge = await credits.charge(userId, cost, ORACLE_CREDITS_MODULE)
  if (!charge.ok) {
    return {
      ok: false,
      code: charge.reason === 'insufficient' ? 'insufficient_credits' : 'credits_error',
      message: charge.reason === 'insufficient' ? 'insufficient credits' : 'could not update credits',
      balance: charge.balance,
    }
  }

  // An admin charge is skipped rather than taken. Recording 0 keeps the row
  // truthful and makes every refund path (which derives its amount from this
  // column) correctly do nothing instead of granting free credits.
  const chargedAmount = charge.skipped ? 0 : cost

  const seed = makeSeed()
  const systems = resolveSystems(request.systems)
  const roster = readerRosterFor(request.readerCount)
  const question = request.question?.trim() ? request.question.trim() : null
  const startedAt = now()
  const nowIso = startedAt.toISOString()

  let session: OracleJobSession
  try {
    session = await store.insertSession({
      user_id: userId,
      kind: request.kind,
      subject_profile_id: request.subjectProfileId,
      partner_profile_id: request.partnerProfileId ?? null,
      scope: request.scope,
      systems,
      session_inputs: sessionInputs.value,
      question_raw: question,
      reader_count: request.readerCount,
      reader_roster: roster,
      status: 'computing',
      progress: initialProgress(systems, roster),
      seed,
      next_action: 'compute',
      credits_charged: chargedAmount,
      charged_at: nowIso,
      locale: request.locale,
      prompt_version: ORACLE_PROMPT_VERSION,
      last_heartbeat_at: nowIso,
    })
  } catch (e) {
    // Nothing was created, so there is no row to mark failed — just give the credits back.
    await credits.refund(userId, chargedAmount)
    return {
      ok: false,
      code: 'compute_failed',
      message: e instanceof Error ? e.message : 'could not create session',
    }
  }

  try {
    // 4 + 5. All engines, the axis projection, and consensus.
    const computed = runComputations({
      profile: subject,
      systems,
      seed,
      asOfDate: civilDateIn(startedAt, subject.tz ?? 'UTC'),
      locale: request.locale,
      kind: request.kind,
      question,
      sessionInputs: sessionInputs.value,
      personalData: personalDataFrom(profiles),
    })

    const rows = await store.upsertComputations(
      computed.systems.map((entry) => ({
        session_id: session.id,
        system: entry.system,
        result: entry.result,
        ai_payload: entry.aiPayload,
        axes: entry.axes,
        engine_version: entry.engineVersion,
      })),
    )

    await store.upsertConsensus({
      session_id: session.id,
      system_agreement: consensusJson(computed.consensus),
      deficiency_vector: computed.consensus.elements.deficiency,
      domain_stats: {
        elements: { total: computed.consensus.elements.total, excess: computed.consensus.elements.excess },
        readingScope: computed.readingScope,
        assumptions: computed.assumptions,
      },
    })

    // 6. A system that produced no vote will never produce a reading either,
    //    so its unit is already a 결번 before layer 1 starts.
    let progress = initialProgress(systems, roster)
    for (const entry of computed.systems) {
      if (entry.vote === null) progress = markUnitFailed(progress, readingUnit(entry.system))
    }

    const updated = await store.updateSession(session.id, {
      status: 'layer1',
      next_action: 'layer1',
      progress,
      last_heartbeat_at: now().toISOString(),
    })

    return {
      ok: true,
      reused: false,
      session: updated ?? { ...session, status: 'layer1', next_action: 'layer1', progress },
      computations: rows.map(publicComputation),
    }
  } catch (e) {
    await store.updateSession(session.id, {
      status: 'failed',
      next_action: null,
      completed_at: now().toISOString(),
      lease_until: null,
    })
    await credits.refund(userId, chargedAmount)

    const message =
      e instanceof OracleComputeError || e instanceof OraclePrivacyError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'computation failed'
    return { ok: false, code: 'compute_failed', message, sessionId: session.id }
  }
}

/** Exposed so the poll route can label a session's scope the same way create did. */
export { readingScopeForSession }
