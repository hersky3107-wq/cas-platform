/**
 * Runner contracts. Ports only — no Supabase import, no `next/server`, no
 * provider SDK. Everything the runner touches is behind an interface so the
 * state machine can be unit-tested without a database and without network.
 *
 * `store.ts` and `credits.ts` hold the real implementations; the routes wire
 * them together.
 */
import type {
  OracleComputation,
  OracleConsensus,
  OracleJobProgress,
  OracleJobSession,
  OracleNextAction,
  OracleProfile,
  OracleReaderCount,
  OracleReading,
  OracleSessionKind,
  OracleSessionScope,
  OracleSessionStatus,
  OracleVerdict,
} from '../schema'
import type { OracleUnitStatus } from './conventions'
import type { OracleSessionInputs } from './session-inputs'

/** A jsonb column value. */
export type JsonObject = Record<string, unknown>

// ─── AI adapter ──────────────────────────────────────────────────────────
//
// The stub in ai-stub.ts and the real provider adapter that replaces it
// implement exactly this interface, so swapping them is a one-line change
// at the route wiring.

export type OracleAiUnitKind = 'reading' | 'verdict'

export type OracleAiRequest = {
  kind: OracleAiUnitKind
  sessionId: string
  /** System id for a reading, reader slug for a verdict. */
  unit: string
  locale: string
  /** Session seed — makes a stubbed or sampled response reproducible. */
  seed: string
  /**
   * The prompt input. Built by payload.ts and guaranteed to carry no birth
   * date, birth time, birth place, or name (see privacy.ts).
   */
  payload: JsonObject
}

export type OracleAiOk = {
  ok: true
  brand: string
  model: string
  text: string
  summary: JsonObject | null
  latencyMs: number
  tokensIn: number
  tokensOut: number
}

export type OracleAiFailure = {
  ok: false
  brand: string
  model: string
  /** 'timeout' is a 결번; 'error' is a provider failure. Both continue the run. */
  status: Exclude<OracleUnitStatus, 'done'>
  message: string
  latencyMs: number
}

export type OracleAiResult = OracleAiOk | OracleAiFailure

export type OracleAiAdapter = {
  run(request: OracleAiRequest, options: { timeoutMs: number }): Promise<OracleAiResult>
}

// ─── credits port ────────────────────────────────────────────────────────

export type CreditsChargeResult =
  | { ok: true; balance: number | null; skipped: boolean }
  | { ok: false; reason: 'insufficient' | 'error'; balance: number | null }

export type CreditsPort = {
  charge(userId: string, amount: number, moduleName: string): Promise<CreditsChargeResult>
  /** No-op when the original charge was skipped (admin) or already refunded. */
  refund(userId: string, amount: number): Promise<void>
}

// ─── store port ──────────────────────────────────────────────────────────

export type SessionInsert = {
  user_id: string
  kind: OracleSessionKind
  subject_profile_id: string
  partner_profile_id: string | null
  scope: OracleSessionScope
  systems: string[]
  session_inputs: OracleSessionInputs | null
  question_raw: string | null
  reader_count: OracleReaderCount
  reader_roster: string[]
  status: OracleSessionStatus
  progress: OracleJobProgress
  seed: string
  next_action: OracleNextAction | null
  credits_charged: number | null
  charged_at: string | null
  locale: string | null
  prompt_version: string | null
  last_heartbeat_at: string | null
}

export type SessionPatch = {
  status?: OracleSessionStatus
  next_action?: OracleNextAction | null
  progress?: OracleJobProgress
  lease_until?: string | null
  last_heartbeat_at?: string | null
  attempt_count?: number
  completed_at?: string | null
  reader_roster?: string[]
}

export type ComputationInsert = {
  session_id: string
  system: string
  result: JsonObject | null
  ai_payload: JsonObject | null
  axes: JsonObject | null
  engine_version: string | null
}

export type ReadingInsert = {
  session_id: string
  computation_id: string
  system: string
  brand: string
  model: string
  narrative: string | null
  summary: JsonObject | null
  status: OracleUnitStatus
  latency_ms: number | null
  tokens_in: number | null
  tokens_out: number | null
}

export type VerdictInsert = {
  session_id: string
  reader_slug: string
  brand: string
  model: string
  verdict_line: string | null
  ballot: JsonObject | null
  dissent: string | null
  full_text: string | null
  status: OracleUnitStatus
  latency_ms: number | null
  tokens_in: number | null
  tokens_out: number | null
}

export type ConsensusUpsert = {
  session_id: string
  system_agreement?: JsonObject | null
  ballot_tally?: JsonObject | null
  domain_stats?: JsonObject | null
  unanimous?: boolean | null
  deficiency_vector?: JsonObject | null
}

/**
 * Every database touch the runner needs.
 *
 * The UNIQUE constraints on oracle_computations (session_id, system),
 * oracle_readings (session_id, system), and oracle_verdicts
 * (session_id, reader_slug) are the idempotency guarantee: the
 * `insert*IfAbsent` methods return false instead of throwing when the row
 * already exists, so re-running a chunk can never duplicate rows.
 */
export type RunnerStore = {
  /** The user's session in an ORACLE_ACTIVE_STATUSES status, if any. */
  findActiveSession(userId: string): Promise<OracleJobSession | null>
  /** Only rows owned by `userId`; a foreign id simply does not come back. */
  loadProfiles(userId: string, profileIds: string[]): Promise<OracleProfile[]>
  insertSession(row: SessionInsert): Promise<OracleJobSession>
  getSession(sessionId: string): Promise<OracleJobSession | null>
  updateSession(sessionId: string, patch: SessionPatch): Promise<OracleJobSession | null>

  /**
   * Atomic conditional claim: takes the lease only when it is free or
   * expired, bumps attempt_count, and stamps the heartbeat. Returns null
   * when another worker holds it.
   */
  claimLease(sessionId: string, leaseUntil: string, nowIso: string): Promise<OracleJobSession | null>
  touchHeartbeat(sessionId: string, nowIso: string): Promise<void>

  upsertComputations(rows: ComputationInsert[]): Promise<OracleComputation[]>
  listComputations(sessionId: string): Promise<OracleComputation[]>

  insertReadingIfAbsent(row: ReadingInsert): Promise<boolean>
  listReadings(sessionId: string): Promise<OracleReading[]>

  insertVerdictIfAbsent(row: VerdictInsert): Promise<boolean>
  listVerdicts(sessionId: string): Promise<OracleVerdict[]>

  upsertConsensus(row: ConsensusUpsert): Promise<void>
  getConsensus(sessionId: string): Promise<OracleConsensus | null>

  /** Non-terminal sessions with a stale heartbeat and a free lease. */
  listStaleSessions(limit: number, staleBeforeIso: string, nowIso: string): Promise<OracleJobSession[]>
}

/** Injected so tests can drive time and seeds deterministically. */
export type RunnerClock = () => Date
export type SeedFactory = () => string

/**
 * How background work is handed off. The routes pass Next's `after()`; tests
 * pass a collector so the chunk can be awaited.
 */
export type ScheduleBackground = (task: () => Promise<void>) => void
