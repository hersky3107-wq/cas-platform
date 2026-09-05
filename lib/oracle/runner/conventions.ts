/**
 * Named constants for the ORACLE job runner. Do not inline these at call sites.
 *
 * Computation is NOT chunked. The full 12-system calculation benchmarks at
 * ~8ms per subject, so every engine + the axis projection + consensus run
 * synchronously inside the create request. Only AI units — layer-1 readings
 * and layer-2 verdicts — are chunked, because those are the calls that stall
 * for tens of seconds and lose the HTTP connection on mobile screen lock.
 */
import type { ReadingScope } from '../axes/types'
import { ORACLE_SEER_SLUGS, type OracleSeerSlug } from '../ai/seer-roster'
import type { OracleSessionKind, OracleSessionScope, OracleSessionStatus } from '../schema'

export const ORACLE_RUNNER_VERSION = '1.0.0'

/** How long a claimed lease is held before the sweeper may take it over. */
export const ORACLE_LEASE_SECONDS = 150

/**
 * While parallel AI units are in flight, renew `last_heartbeat_at` and extend
 * `lease_until` on this interval so a slow chunk is not mistaken for dead.
 */
export const ORACLE_LEASE_HEARTBEAT_SECONDS = 20

/** A non-terminal session whose heartbeat is older than this is stuck. */
export const ORACLE_STALE_HEARTBEAT_SECONDS = 60

/** Layer-1 readings started per advance call: 12 systems → 3 chunks. */
export const ORACLE_LAYER1_CHUNK_SIZE = 4

/**
 * Hard ceiling per AI unit. On expiry the row is written with status
 * 'timeout' and the run CONTINUES — a missing system is a 결번, not a
 * failed session.
 */
export const ORACLE_AI_UNIT_TIMEOUT_MS = 25_000

/**
 * Consecutive fruitless lease claims tolerated before the session is closed
 * out. `attempt_count` is reset to 0 by any chunk that completes at least
 * one unit, so a healthy 5-chunk run (3 × layer1 + layer2 + finalize) never
 * trips this — only a session that keeps claiming the lease and producing
 * nothing does.
 */
export const ORACLE_MAX_ATTEMPTS = 4

/**
 * Ceiling on AI units in flight. Over the cap a chunk defers without doing
 * work and the sweeper retries it. This gauge is PROCESS-LOCAL: on a
 * multi-instance deploy each instance enforces its own cap, so the effective
 * global limit is (instances × this). A true global cap needs a counter
 * table; that is deliberately out of scope here.
 */
export const ORACLE_MAX_CONCURRENT_AI_UNITS = 50

/** Sessions advanced per cron sweep. */
export const ORACLE_SWEEP_BATCH_SIZE = 20

/** Statuses that mean "this user already has a session in flight". */
export const ORACLE_ACTIVE_STATUSES = [
  'queued',
  'computing',
  'layer1',
  'layer2',
] as const satisfies readonly OracleSessionStatus[]

/** Statuses no advance or sweep may move. */
export const ORACLE_TERMINAL_STATUSES = [
  'done',
  'partial',
  'failed',
] as const satisfies readonly OracleSessionStatus[]

/** Per-row outcome on oracle_readings / oracle_verdicts. */
export const ORACLE_UNIT_STATUSES = ['done', 'timeout', 'error'] as const
export type OracleUnitStatus = (typeof ORACLE_UNIT_STATUSES)[number]

/**
 * Layer-2 seer roster (combined mode only). `reader_count` (3/5/7/9) takes
 * the first N in order, so the ORDER is a product decision — see
 * lib/oracle/ai/seer-roster.ts for the personas, decision rules, and brand
 * seats behind these slugs.
 */
export const ORACLE_READER_ROSTER = ORACLE_SEER_SLUGS
export type OracleReaderSlug = OracleSeerSlug

export function readerRosterFor(readerCount: number): string[] {
  return ORACLE_READER_ROSTER.slice(0, readerCount)
}

/** `credit_logs.module` for every oracle session charge. */
export const ORACLE_CREDITS_MODULE = 'oracle_session'

/**
 * Stamped on oracle_job_sessions.prompt_version when ORACLE_AI_MODE is stub
 * (the default). Live sessions stamp LAYER1_PROMPT_VERSION instead.
 */
export const ORACLE_PROMPT_VERSION = 'stub-0'

/**
 * Provisional product prices. Pricing is data, not arithmetic embedded in
 * orchestration, so changing a seat or synthesizer price never changes charge
 * logic. Every value includes the synthesizer call.
 */
export const ORACLE_SESSION_CREDIT_PRICES: Record<OracleSessionScope, Partial<Record<number, number>>> = {
  single: { 3: 6, 5: 10, 7: 15 },
  combined: { 3: 25, 5: 32, 7: 40, 9: 50 },
}

export function creditsForOracleSession(scope: OracleSessionScope, readerCount: number): number {
  const price = ORACLE_SESSION_CREDIT_PRICES[scope][readerCount]
  if (price == null) throw new Error(`no Oracle credit price for ${scope} N=${readerCount}`)
  return price
}

/**
 * Which temporal lens the axis layer weights phase votes for. A daily
 * reading is about today; a question is about the draw; everything else is
 * the life-scale lens. See PHASE_SCOPE_WEIGHT in axes/conventions.ts.
 */
export function readingScopeForSession(kind: OracleSessionKind, hasQuestion: boolean): ReadingScope {
  if (kind === 'daily') return 'today'
  if (hasQuestion) return 'question'
  return 'life'
}

/** Fallbacks used when a profile is missing location data, recorded as assumptions. */
export const ORACLE_DEFAULT_TIMEZONE = 'Asia/Seoul'
export const ORACLE_DEFAULT_COORDS = { lat: 37.5665, lng: 126.978 } as const

/** Default tarot spread / rune count when session_inputs omit a user draw. */
export const ORACLE_TAROT_SPREAD = 3 as const
export const ORACLE_RUNE_COUNT = 3
export const ORACLE_TAROT_DECK_SIZE = 78
/** The rune cloth: all 24 Elder Futhark stones, face down. */
export const ORACLE_RUNE_POOL_SIZE = 24
