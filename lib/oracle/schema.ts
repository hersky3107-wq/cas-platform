/**
 * Row shapes for the ORACLE rebuild tables (20260815000001).
 *
 * Contract only — no Supabase import, no I/O. Routes that eventually write
 * these tables must use supabaseAdmin and still scope every query to the
 * session uid. `model` on readings/verdicts is server-only and must never
 * be selected by a client-facing query.
 *
 * Physical table for job sessions is `oracle_job_sessions` (the spec name
 * `oracle_sessions` is already taken by the 20260530000001 share archive).
 */

export const ORACLE_BIRTH_TIME_SOURCES = ['exact', 'estimated', 'unknown'] as const
export type OracleBirthTimeSource = (typeof ORACLE_BIRTH_TIME_SOURCES)[number]

export const ORACLE_SEXES = ['M', 'F'] as const
export type OracleSex = (typeof ORACLE_SEXES)[number]

export const ORACLE_SESSION_KINDS = ['personal', 'compat', 'daily', 'talisman'] as const
export type OracleSessionKind = (typeof ORACLE_SESSION_KINDS)[number]

export const ORACLE_SESSION_SCOPES = ['single', 'combined'] as const
export type OracleSessionScope = (typeof ORACLE_SESSION_SCOPES)[number]

export const ORACLE_READER_COUNTS = [3, 5, 7, 9] as const
export type OracleReaderCount = (typeof ORACLE_READER_COUNTS)[number]

export const ORACLE_SESSION_STATUSES = [
  'queued',
  'computing',
  'layer1',
  'layer2',
  'done',
  'partial',
  'failed',
] as const
export type OracleSessionStatus = (typeof ORACLE_SESSION_STATUSES)[number]

export const ORACLE_NEXT_ACTIONS = ['compute', 'layer1', 'layer2', 'consensus'] as const
export type OracleNextAction = (typeof ORACLE_NEXT_ACTIONS)[number]

export type OracleJobProgress = {
  done: string[]
  pending: string[]
  failed: string[]
}

export type OraclePrismSessionInput = {
  impulse: string
  need: string
  identity: string
  microCheck?: readonly [number, number, number, number]
}

/**
 * Per-reading state, never profile identity. Generic bag so future systems
 * can add inputs without another migration.
 */
export type OracleSessionInputs = {
  prism?: OraclePrismSessionInput
} & Record<string, unknown>

/** public.oracle_profiles */
export type OracleProfile = {
  id: string
  user_id: string
  label: string
  is_self: boolean
  /** YYYY-MM-DD */
  birth_date: string
  /** HH:mm:ss, or null when birth_time_source is unknown */
  birth_time: string | null
  birth_time_source: OracleBirthTimeSource
  /** ONLY used for 대운 direction. Never sent to any AI. */
  sex: OracleSex | null
  birth_place: string | null
  lat: number | null
  lng: number | null
  tz: string | null
  name_local: string | null
  name_hanja: string | null
  name_latin: string | null
  mbti: string | null
  survey_answers: Record<string, unknown> | null
  derived: Record<string, unknown>
  derived_engine_versions: Record<string, unknown>
  created_at: string
  updated_at: string
}

/** public.oracle_job_sessions — spec name was oracle_sessions */
export type OracleJobSession = {
  id: string
  user_id: string
  kind: OracleSessionKind
  subject_profile_id: string
  partner_profile_id: string | null
  scope: OracleSessionScope
  systems: string[]
  session_inputs: OracleSessionInputs | null
  question_raw: string | null
  question_parsed: Record<string, unknown> | null
  reader_count: OracleReaderCount
  reader_roster: string[]
  status: OracleSessionStatus
  progress: OracleJobProgress
  seed: string
  next_action: OracleNextAction | null
  lease_until: string | null
  attempt_count: number
  last_heartbeat_at: string | null
  credits_charged: number | null
  charged_at: string | null
  locale: string | null
  prompt_version: string | null
  created_at: string
  completed_at: string | null
}

/** Alias matching the spec table name. Prefer OracleJobSession in new code. */
export type OracleSession = OracleJobSession

/** public.oracle_computations */
export type OracleComputation = {
  id: string
  session_id: string
  system: string
  result: Record<string, unknown> | null
  ai_payload: Record<string, unknown> | null
  axes: Record<string, unknown> | null
  engine_version: string | null
}

/** public.oracle_readings — `model` is server-only, never return to the client */
export type OracleReading = {
  id: string
  session_id: string
  computation_id: string
  system: string
  brand: string
  model: string
  narrative: string | null
  summary: Record<string, unknown> | null
  status: string | null
  latency_ms: number | null
  tokens_in: number | null
  tokens_out: number | null
}

/** public.oracle_verdicts — `model` is server-only, never return to the client */
export type OracleVerdict = {
  id: string
  session_id: string
  reader_slug: string
  brand: string
  model: string
  verdict_line: string | null
  ballot: Record<string, unknown> | null
  dissent: string | null
  full_text: string | null
  status: string | null
  latency_ms: number | null
  tokens_in: number | null
  tokens_out: number | null
}

/** public.oracle_consensus */
export type OracleConsensus = {
  session_id: string
  system_agreement: Record<string, unknown> | null
  ballot_tally: Record<string, unknown> | null
  domain_stats: Record<string, unknown> | null
  unanimous: boolean | null
  deficiency_vector: Record<string, unknown> | null
  computed_at: string
}

/** public.oracle_daily_cache — global, not per-user */
export type OracleDailyCache = {
  /** YYYY-MM-DD */
  date: string
  values: Record<string, unknown>
  computed_at: string
}
