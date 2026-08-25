/**
 * ORACLE job runner — public surface.
 *
 * `store.ts` and `credits.ts` are deliberately NOT re-exported here: both
 * construct real clients at module load (Supabase env, `server-only`), which
 * would make this barrel unimportable from a unit test. Routes import those
 * two directly.
 */
export {
  creditsForOracleSession,
  readerRosterFor,
  readingScopeForSession,
  ORACLE_ACTIVE_STATUSES,
  ORACLE_AI_UNIT_TIMEOUT_MS,
  ORACLE_CREDITS_MODULE,
  ORACLE_LAYER1_CHUNK_SIZE,
  ORACLE_LEASE_SECONDS,
  ORACLE_LEASE_HEARTBEAT_SECONDS,
  ORACLE_MAX_ATTEMPTS,
  ORACLE_MAX_CONCURRENT_AI_UNITS,
  ORACLE_PROMPT_VERSION,
  ORACLE_READER_ROSTER,
  ORACLE_RUNNER_VERSION,
  ORACLE_SESSION_CREDIT_PRICES,
  ORACLE_STALE_HEARTBEAT_SECONDS,
  ORACLE_SWEEP_BATCH_SIZE,
  ORACLE_TERMINAL_STATUSES,
  ORACLE_UNIT_STATUSES,
} from './conventions'
export type { OracleReaderSlug, OracleUnitStatus } from './conventions'

export { advanceOracleSession, runOracleChunk } from './advance'
export type { AdvanceDeps, AdvanceOutcome } from './advance'

export { createOracleSession, civilDateIn } from './create'
export type {
  CreateSessionDeps,
  CreateSessionFailureCode,
  CreateSessionOutcome,
  CreateSessionRequest,
  PublicComputation,
} from './create'

export { OracleComputeError, personalDataFrom, resolveSystems, runComputations } from './compute'
export type { ComputeAssumptions, ComputedSystem, ComputeInput, ComputeOutput } from './compute'

export { createStubAiAdapter, stubAiConfigFromEnv, ORACLE_STUB_BRAND, ORACLE_STUB_MODEL } from './ai-stub'
export type { StubAiConfig } from './ai-stub'

export { ballotTallyJson, tallyBallots } from './ballot'
export type { BallotTally } from './ballot'

export { inFlightAiUnits, releaseAiSlots, resetAiSlots, tryAcquireAiSlots } from './concurrency'

export { buildReadingPayload, buildSynthesisPayload, buildVerdictPayload } from './payload'
export type { OracleAiContext, PayloadContext } from './payload'

export { assertNoPersonalData, isFreeOfPersonalData, OraclePrivacyError } from './privacy'
export type { PersonalData } from './privacy'

export { validateSessionInputs } from './session-inputs'
export type {
  OraclePrismSessionInput,
  OracleSessionInputs,
  SessionInputsValidation,
} from './session-inputs'

export {
  emptyProgress,
  initialProgress,
  markUnitDone,
  markUnitFailed,
  parseUnit,
  progressCounts,
  readingUnit,
  SYNTHESIS_UNIT,
  verdictUnit,
  READING_UNIT_PREFIX,
  VERDICT_UNIT_PREFIX,
} from './progress'

export { readOracleSession } from './poll'
export type { OracleSessionView, PublicConsensus, PublicReading, PublicVerdict } from './poll'

export { sweepOracleSessions } from './sweep'
export type { SweepSummary } from './sweep'

export type {
  ComputationInsert,
  ConsensusUpsert,
  CreditsChargeResult,
  CreditsPort,
  JsonObject,
  OracleAiAdapter,
  OracleAiFailure,
  OracleAiOk,
  OracleAiRequest,
  OracleAiResult,
  OracleAiUnitKind,
  ReadingInsert,
  RunnerClock,
  RunnerStore,
  ScheduleBackground,
  SeedFactory,
  SessionInsert,
  SessionPatch,
  VerdictInsert,
} from './types'
