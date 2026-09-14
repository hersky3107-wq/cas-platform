import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import {
  GENERATION_ACTIVE_STATUSES,
  GENERATION_TERMINAL_STATUSES,
  type GenerationJobStatus,
} from './policy'

/**
 * Store for `league_generation_jobs` (migration 20260914000001), mirroring
 * `lib/oracle/runner/store.ts` — same atomic lease claim (conditional UPDATE
 * on attempt_count + free lease), same heartbeat touch, same stale-listing
 * query shape. Uses supabaseAdmin per repo convention; RLS on the table is
 * defense-in-depth (service-role only, no policies).
 *
 * MONEY RULE: one row = one purchase (or one system job). `charged` +
 * `charged_cost` + `deduct_skipped` + `refunded` have exactly the
 * `league_deep_runs` semantics, so the refund path is the same shape the
 * deep-analysis flow already uses. `markJobRefundedOnce` is a conditional
 * UPDATE (charged=true AND refunded=false), so a refund can only ever be
 * granted once per row no matter how many workers race it.
 */

const JOBS = 'league_generation_jobs'

/** Postgres unique_violation — the idempotency signal, not an error. */
const UNIQUE_VIOLATION = '23505'

export type LeagueGenerationJob = {
  id: string
  round_id: string
  user_id: string | null
  status: GenerationJobStatus
  stage: string
  locale: string
  charged: boolean
  charged_cost: number
  deduct_skipped: boolean
  refunded: boolean
  attempt_count: number
  lease_until: string | null
  last_heartbeat_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export type JobPatch = Partial<
  Pick<
    LeagueGenerationJob,
    | 'status'
    | 'stage'
    | 'lease_until'
    | 'last_heartbeat_at'
    | 'attempt_count'
    | 'last_error'
    | 'completed_at'
    | 'refunded'
  >
> & { updated_at?: string }

export type JobInsert = {
  round_id: string
  user_id: string | null
  locale: string
  charged: boolean
  charged_cost: number
  deduct_skipped: boolean
}

function quotedList(values: readonly string[]): string {
  return `(${values.map((value) => `"${value}"`).join(',')})`
}

/** `lease_until IS NULL OR lease_until < now` as a PostgREST filter (oracle store verbatim). */
function freeLeaseFilter(nowIso: string): string {
  return `lease_until.is.null,lease_until.lt.${nowIso}`
}

export type InsertJobResult =
  | { ok: true; job: LeagueGenerationJob }
  | { ok: false; reason: 'active_conflict' }

/**
 * Enqueue a work job (status 'queued', stage 'packet'). The partial unique
 * index on (round_id) WHERE status IN ('queued','running') makes a second
 * concurrent enqueue for the same round come back as `active_conflict` — the
 * caller attaches to the existing job instead of double-running the roster.
 */
export async function insertGenerationJob(input: JobInsert): Promise<InsertJobResult> {
  const { data, error } = await supabaseAdmin
    .from(JOBS)
    .insert({ ...input, status: 'queued', stage: 'packet' })
    .select('*')
    .single()
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: 'active_conflict' }
    throw new Error(`insertGenerationJob: ${error.message}`)
  }
  return { ok: true, job: data as LeagueGenerationJob }
}

/**
 * Record a paid view of a round that needs no work (or a paid attach to a
 * job someone else is running): a row born terminal — status 'done', stage
 * 'view'. It is the user's permanent-access receipt, never claimed by the
 * sweeper (sweeps filter on active statuses).
 */
export async function insertAccessPurchase(input: JobInsert): Promise<LeagueGenerationJob> {
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from(JOBS)
    .insert({ ...input, status: 'done', stage: 'view', completed_at: now })
    .select('*')
    .single()
  if (error) throw new Error(`insertAccessPurchase: ${error.message}`)
  return data as LeagueGenerationJob
}

export async function getGenerationJob(jobId: string): Promise<LeagueGenerationJob | null> {
  const { data, error } = await supabaseAdmin.from(JOBS).select('*').eq('id', jobId).maybeSingle()
  if (error) throw new Error(`getGenerationJob: ${error.message}`)
  return (data as LeagueGenerationJob | null) ?? null
}

export async function updateGenerationJob(jobId: string, patch: JobPatch): Promise<void> {
  const { error } = await supabaseAdmin
    .from(JOBS)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId)
  if (error) throw new Error(`updateGenerationJob: ${error.message}`)
}

/**
 * Atomic claim (oracle store verbatim): read attempt_count, then a
 * conditional UPDATE keyed on that attempt_count AND a free/expired lease.
 * Two workers that read the same row cannot both win — Postgres re-evaluates
 * the predicate after taking the row lock.
 */
export async function claimGenerationJobLease(
  jobId: string,
  leaseUntil: string,
  nowIso: string
): Promise<LeagueGenerationJob | null> {
  const { data: current, error: readError } = await supabaseAdmin
    .from(JOBS)
    .select('attempt_count,status')
    .eq('id', jobId)
    .maybeSingle()
  if (readError) throw new Error(`claimGenerationJobLease read: ${readError.message}`)
  if (!current) return null

  const row = current as { attempt_count: number; status: string }
  if ((GENERATION_TERMINAL_STATUSES as readonly string[]).includes(row.status)) return null

  const { data, error } = await supabaseAdmin
    .from(JOBS)
    .update({
      status: 'running',
      lease_until: leaseUntil,
      last_heartbeat_at: nowIso,
      attempt_count: row.attempt_count + 1,
      updated_at: nowIso,
    })
    .eq('id', jobId)
    .eq('attempt_count', row.attempt_count)
    .or(freeLeaseFilter(nowIso))
    .select('*')
    .maybeSingle()
  if (error) throw new Error(`claimGenerationJobLease: ${error.message}`)
  return (data as LeagueGenerationJob | null) ?? null
}

export async function touchGenerationJobHeartbeat(jobId: string, nowIso: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from(JOBS)
    .update({ last_heartbeat_at: nowIso })
    .eq('id', jobId)
  if (error) throw new Error(`touchGenerationJobHeartbeat: ${error.message}`)
}

/** Queued or stale-running jobs whose lease is free — the sweep's claim candidates. */
export async function listClaimableGenerationJobs(
  limit: number,
  staleBeforeIso: string,
  nowIso: string
): Promise<LeagueGenerationJob[]> {
  const { data, error } = await supabaseAdmin
    .from(JOBS)
    .select('*')
    .in('status', [...GENERATION_ACTIVE_STATUSES])
    .or(`last_heartbeat_at.is.null,last_heartbeat_at.lt.${staleBeforeIso}`)
    .or(freeLeaseFilter(nowIso))
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`listClaimableGenerationJobs: ${error.message}`)
  return (data ?? []) as LeagueGenerationJob[]
}

/** Jobs actively being worked right now: status 'running' with a live lease. */
export async function countRunningGenerationJobs(nowIso: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(JOBS)
    .select('id', { count: 'exact', head: true })
    .eq('status', 'running')
    .gt('lease_until', nowIso)
  if (error) throw new Error(`countRunningGenerationJobs: ${error.message}`)
  return count ?? 0
}

/** All live work (queued + running) — press-time backpressure reads this. */
export async function countActiveGenerationJobs(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(JOBS)
    .select('id', { count: 'exact', head: true })
    .in('status', [...GENERATION_ACTIVE_STATUSES])
  if (error) throw new Error(`countActiveGenerationJobs: ${error.message}`)
  return count ?? 0
}

export async function findActiveJobForRound(roundId: string): Promise<LeagueGenerationJob | null> {
  const { data, error } = await supabaseAdmin
    .from(JOBS)
    .select('*')
    .eq('round_id', roundId)
    .in('status', [...GENERATION_ACTIVE_STATUSES])
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`findActiveJobForRound: ${error.message}`)
  return (data as LeagueGenerationJob | null) ?? null
}

/** Latest WORK job for the round (view purchases excluded) — failure display reads this. */
export async function latestWorkJobForRound(roundId: string): Promise<LeagueGenerationJob | null> {
  const { data, error } = await supabaseAdmin
    .from(JOBS)
    .select('*')
    .eq('round_id', roundId)
    .neq('stage', 'view')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`latestWorkJobForRound: ${error.message}`)
  return (data as LeagueGenerationJob | null) ?? null
}

/**
 * PERMANENT ACCESS check: has this user a live (charged, never refunded)
 * purchase row for this round? Both job rows and 'view' rows count — the
 * purchase is the row, whichever shape it took.
 */
export async function hasPaidRoundAccess(roundId: string, userId: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin
    .from(JOBS)
    .select('id', { count: 'exact', head: true })
    .eq('round_id', roundId)
    .eq('user_id', userId)
    .eq('charged', true)
    .eq('refunded', false)
    .limit(1)
  if (error) throw new Error(`hasPaidRoundAccess: ${error.message}`)
  return (count ?? 0) > 0
}

/** Was this user refunded on this round (money came back)? Drives the locked-state notice. */
export async function wasRefundedForRound(roundId: string, userId: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin
    .from(JOBS)
    .select('id', { count: 'exact', head: true })
    .eq('round_id', roundId)
    .eq('user_id', userId)
    .eq('charged', true)
    .eq('refunded', true)
    .limit(1)
  if (error) throw new Error(`wasRefundedForRound: ${error.message}`)
  return (count ?? 0) > 0
}

/** Every purchase on the round that still holds money (terminal-failure refund set). */
export async function listChargedUnrefundedForRound(roundId: string): Promise<LeagueGenerationJob[]> {
  const { data, error } = await supabaseAdmin
    .from(JOBS)
    .select('*')
    .eq('round_id', roundId)
    .eq('charged', true)
    .eq('refunded', false)
  if (error) throw new Error(`listChargedUnrefundedForRound: ${error.message}`)
  return (data ?? []) as LeagueGenerationJob[]
}

/**
 * Flip refunded exactly once. Returns the row when THIS call won the flip,
 * null when someone already refunded it (or it was never charged). The
 * caller only moves credits when it wins — that conditional is the whole
 * "refunds exactly once" guarantee.
 */
export async function markJobRefundedOnce(jobRowId: string): Promise<LeagueGenerationJob | null> {
  const { data, error } = await supabaseAdmin
    .from(JOBS)
    .update({ refunded: true, updated_at: new Date().toISOString() })
    .eq('id', jobRowId)
    .eq('charged', true)
    .eq('refunded', false)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(`markJobRefundedOnce: ${error.message}`)
  return (data as LeagueGenerationJob | null) ?? null
}

/**
 * Resume state — THE single source of truth (the user's spec): which models
 * already have rows for this round. `model_predictions` is unique on
 * (round_id, model_id), so this list is exactly "work that must not be
 * redone".
 */
export async function listRoundModelRows(
  roundId: string
): Promise<Array<{ model_id: string; predicted_direction: string | null; predicted_at: string }>> {
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select('model_id, predicted_direction, predicted_at')
    .eq('round_id', roundId)
  if (error) throw new Error(`listRoundModelRows: ${error.message}`)
  return (data ?? []) as Array<{ model_id: string; predicted_direction: string | null; predicted_at: string }>
}

/**
 * "Complete" = the round has a persisted final consensus (every finished
 * generation ends by persisting it), or a finished work job says so. A round
 * that died mid-roster before this feature has rows but no consensus — it
 * counts as INCOMPLETE, which is what lets a new purchase resume and finish
 * it instead of selling a broken card.
 */
export async function isRoundComplete(roundId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('consensus_aggregate_direction')
    .eq('id', roundId)
    .maybeSingle()
  if (error) throw new Error(`isRoundComplete: ${error.message}`)
  if ((data as { consensus_aggregate_direction: string | null } | null)?.consensus_aggregate_direction) {
    return true
  }
  const { count, error: jobError } = await supabaseAdmin
    .from(JOBS)
    .select('id', { count: 'exact', head: true })
    .eq('round_id', roundId)
    .eq('status', 'done')
    .eq('stage', 'done')
    .limit(1)
  if (jobError) throw new Error(`isRoundComplete jobs: ${jobError.message}`)
  return (count ?? 0) > 0
}
