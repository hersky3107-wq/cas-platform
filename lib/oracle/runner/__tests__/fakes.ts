/**
 * In-memory RunnerStore and CreditsPort for the runner tests.
 *
 * Not a *.test.ts file, so vitest does not collect it. The fake store honours
 * the same UNIQUE constraints the migration declares — (session_id, system)
 * and (session_id, reader_slug) — because those constraints ARE the runner's
 * idempotency guarantee and a fake that ignored them would test nothing.
 */
import type {
  OracleComputation,
  OracleConsensus,
  OracleJobProgress,
  OracleJobSession,
  OracleProfile,
  OracleReading,
  OracleVerdict,
} from '../../schema'
import { ORACLE_ACTIVE_STATUSES, ORACLE_TERMINAL_STATUSES } from '../conventions'
import type {
  ComputationInsert,
  ConsensusUpsert,
  CreditsPort,
  ReadingInsert,
  RunnerStore,
  ScheduleBackground,
  SessionInsert,
  SessionPatch,
  VerdictInsert,
} from '../types'

function cloneProgress(progress: OracleJobProgress): OracleJobProgress {
  return { done: [...progress.done], pending: [...progress.pending], failed: [...progress.failed] }
}

function cloneSession(session: OracleJobSession): OracleJobSession {
  return { ...session, progress: cloneProgress(session.progress), systems: [...session.systems], reader_roster: [...session.reader_roster] }
}

export type FakeStore = RunnerStore & {
  profiles: OracleProfile[]
  sessions: OracleJobSession[]
  computations: OracleComputation[]
  readings: OracleReading[]
  verdicts: OracleVerdict[]
  consensus: OracleConsensus[]
  /** Every mutating call. A poll must leave this at 0. */
  writeCount: number
  /** Rejected duplicate inserts — the UNIQUE constraint doing its job. */
  duplicateCount: number
}

export function createFakeStore(options: { profiles?: OracleProfile[] } = {}): FakeStore {
  let nextId = 1
  const id = (prefix: string): string => `${prefix}-${nextId++}`

  const store: FakeStore = {
    profiles: options.profiles ?? [],
    sessions: [],
    computations: [],
    readings: [],
    verdicts: [],
    consensus: [],
    writeCount: 0,
    duplicateCount: 0,

    async findActiveSession(userId) {
      const found = store.sessions
        .filter((row) => row.user_id === userId && (ORACLE_ACTIVE_STATUSES as readonly string[]).includes(row.status))
        .at(-1)
      return found ? cloneSession(found) : null
    },

    async loadProfiles(userId, profileIds) {
      return store.profiles
        .filter((row) => row.user_id === userId && profileIds.includes(row.id))
        .map((row) => ({ ...row }))
    },

    async insertSession(row: SessionInsert) {
      store.writeCount += 1
      const session: OracleJobSession = {
        id: id('session'),
        ...row,
        question_parsed: null,
        lease_until: null,
        attempt_count: 0,
        created_at: new Date(0).toISOString(),
        completed_at: null,
      }
      store.sessions.push(session)
      return cloneSession(session)
    },

    async getSession(sessionId) {
      const found = store.sessions.find((row) => row.id === sessionId)
      return found ? cloneSession(found) : null
    },

    async updateSession(sessionId, patch: SessionPatch) {
      store.writeCount += 1
      const found = store.sessions.find((row) => row.id === sessionId)
      if (!found) return null
      Object.assign(found, patch)
      return cloneSession(found)
    },

    async claimLease(sessionId, leaseUntil, nowIso) {
      const found = store.sessions.find((row) => row.id === sessionId)
      if (!found) return null
      if ((ORACLE_TERMINAL_STATUSES as readonly string[]).includes(found.status)) return null
      const held = found.lease_until !== null && found.lease_until >= nowIso
      if (held) return null
      store.writeCount += 1
      found.lease_until = leaseUntil
      found.last_heartbeat_at = nowIso
      found.attempt_count += 1
      return cloneSession(found)
    },

    async touchHeartbeat(sessionId, nowIso) {
      store.writeCount += 1
      const found = store.sessions.find((row) => row.id === sessionId)
      if (found) found.last_heartbeat_at = nowIso
    },

    async upsertComputations(rows: ComputationInsert[]) {
      store.writeCount += 1
      const out: OracleComputation[] = []
      for (const row of rows) {
        const existing = store.computations.find(
          (candidate) => candidate.session_id === row.session_id && candidate.system === row.system,
        )
        if (existing) {
          Object.assign(existing, row)
          out.push({ ...existing })
          continue
        }
        const created: OracleComputation = { id: id('computation'), ...row }
        store.computations.push(created)
        out.push({ ...created })
      }
      return out
    },

    async listComputations(sessionId) {
      return store.computations
        .filter((row) => row.session_id === sessionId)
        .sort((a, b) => a.system.localeCompare(b.system))
        .map((row) => ({ ...row }))
    },

    async insertReadingIfAbsent(row: ReadingInsert) {
      const clash = store.readings.some(
        (candidate) =>
          candidate.session_id === row.session_id &&
          candidate.system === row.system &&
          candidate.brand === row.brand,
      )
      if (clash) {
        store.duplicateCount += 1
        return false
      }
      store.writeCount += 1
      store.readings.push({ id: id('reading'), ...row })
      return true
    },

    async listReadings(sessionId) {
      return store.readings
        .filter((row) => row.session_id === sessionId)
        .sort((a, b) => a.system.localeCompare(b.system))
        .map((row) => ({ ...row }))
    },

    async insertVerdictIfAbsent(row: VerdictInsert) {
      const clash = store.verdicts.some(
        (candidate) => candidate.session_id === row.session_id && candidate.reader_slug === row.reader_slug,
      )
      if (clash) {
        store.duplicateCount += 1
        return false
      }
      store.writeCount += 1
      store.verdicts.push({ id: id('verdict'), ...row })
      return true
    },

    async listVerdicts(sessionId) {
      return store.verdicts
        .filter((row) => row.session_id === sessionId)
        .sort((a, b) => a.reader_slug.localeCompare(b.reader_slug))
        .map((row) => ({ ...row }))
    },

    async upsertConsensus(row: ConsensusUpsert) {
      store.writeCount += 1
      const existing = store.consensus.find((candidate) => candidate.session_id === row.session_id)
      if (existing) {
        // Mirrors ON CONFLICT DO UPDATE: only supplied keys are written.
        Object.assign(existing, row)
        return
      }
      store.consensus.push({
        session_id: row.session_id,
        system_agreement: row.system_agreement ?? null,
        ballot_tally: row.ballot_tally ?? null,
        domain_stats: row.domain_stats ?? null,
        unanimous: row.unanimous ?? null,
        deficiency_vector: row.deficiency_vector ?? null,
        computed_at: new Date(0).toISOString(),
      })
    },

    async getConsensus(sessionId) {
      const found = store.consensus.find((row) => row.session_id === sessionId)
      return found ? { ...found } : null
    },

    async listStaleSessions(limit, staleBeforeIso, nowIso) {
      return store.sessions
        .filter((row) => !(ORACLE_TERMINAL_STATUSES as readonly string[]).includes(row.status))
        .filter((row) => row.last_heartbeat_at === null || row.last_heartbeat_at < staleBeforeIso)
        .filter((row) => row.lease_until === null || row.lease_until < nowIso)
        .slice(0, limit)
        .map(cloneSession)
    },
  }

  return store
}

export type FakeCredits = CreditsPort & {
  balance: number
  charges: Array<{ userId: string; amount: number; module: string }>
  refunds: Array<{ userId: string; amount: number }>
  /** Set to force the charge to fail. */
  failWith: 'insufficient' | 'error' | null
  /** Set to mimic an admin user, whose charge is skipped rather than taken. */
  skip: boolean
}

export function createFakeCredits(initialBalance = 1_000): FakeCredits {
  const credits: FakeCredits = {
    balance: initialBalance,
    charges: [],
    refunds: [],
    failWith: null,
    skip: false,

    async charge(userId, amount, moduleName) {
      if (credits.failWith) {
        return { ok: false, reason: credits.failWith, balance: credits.balance }
      }
      if (credits.skip) {
        return { ok: true, balance: credits.balance, skipped: true }
      }
      credits.charges.push({ userId, amount, module: moduleName })
      credits.balance -= amount
      return { ok: true, balance: credits.balance, skipped: false }
    },

    async refund(userId, amount) {
      if (amount <= 0) return
      credits.refunds.push({ userId, amount })
      credits.balance += amount
    },
  }
  return credits
}

/** Collects background work so a test can await the chunk that a route would fire-and-forget. */
export function createScheduler(): { schedule: ScheduleBackground; drain: () => Promise<void>; pending: () => number } {
  const tasks: Array<() => Promise<void>> = []
  return {
    schedule: (task) => {
      tasks.push(task)
    },
    async drain() {
      while (tasks.length > 0) {
        const task = tasks.shift()!
        await task()
      }
    },
    pending: () => tasks.length,
  }
}

export function makeProfile(overrides: Partial<OracleProfile> = {}): OracleProfile {
  return {
    id: 'profile-subject',
    user_id: 'user-1',
    label: 'self',
    is_self: true,
    birth_date: '1988-11-23',
    birth_time: '04:17:00',
    birth_time_source: 'exact',
    sex: 'F',
    birth_place: 'Busan',
    lat: 35.1796,
    lng: 129.0756,
    tz: 'Asia/Seoul',
    name_local: '김민서',
    name_hanja: null,
    name_latin: 'Minseo Kim',
    mbti: 'INTJ',
    survey_answers: null,
    derived: {},
    derived_engine_versions: {},
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  }
}
