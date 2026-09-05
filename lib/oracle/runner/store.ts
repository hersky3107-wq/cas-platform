/**
 * RunnerStore backed by Supabase.
 *
 * Uses supabaseAdmin (service role) per repo convention, and every query is
 * still scoped to the session's own user id — RLS is defense-in-depth and the
 * admin client bypasses it, so the app layer has to do the scoping itself.
 *
 * Kept out of the runner barrel on purpose: importing this module constructs
 * the Supabase client from env at load time, which unit tests must not need.
 */
import { supabaseAdmin } from '@/lib/supabase/server'
import type {
  OracleComputation,
  OracleConsensus,
  OracleJobSession,
  OracleProfile,
  OracleReading,
  OracleVerdict,
} from '../schema'
import { ORACLE_ACTIVE_STATUSES, ORACLE_TERMINAL_STATUSES } from './conventions'
import type {
  ComputationInsert,
  ConsensusUpsert,
  ReadingInsert,
  RunnerStore,
  SessionInsert,
  SessionPatch,
  VerdictInsert,
} from './types'

const SESSIONS = 'oracle_job_sessions'
const PROFILES = 'oracle_profiles'
const COMPUTATIONS = 'oracle_computations'
const READINGS = 'oracle_readings'
const VERDICTS = 'oracle_verdicts'
const CONSENSUS = 'oracle_consensus'

/** Postgres unique_violation — the idempotency signal, not an error. */
const UNIQUE_VIOLATION = '23505'

function quotedList(values: readonly string[]): string {
  return `(${values.map((value) => `"${value}"`).join(',')})`
}

/** `lease_until IS NULL OR lease_until < now` as a PostgREST filter. */
function freeLeaseFilter(nowIso: string): string {
  return `lease_until.is.null,lease_until.lt.${nowIso}`
}

export function createSupabaseRunnerStore(): RunnerStore {
  return {
    async findActiveSession(userId: string): Promise<OracleJobSession | null> {
      const { data, error } = await supabaseAdmin
        .from(SESSIONS)
        .select('*')
        .eq('user_id', userId)
        .in('status', [...ORACLE_ACTIVE_STATUSES])
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw new Error(`findActiveSession: ${error.message}`)
      return (data?.[0] as OracleJobSession | undefined) ?? null
    },

    async findLatestCompletedSession(
      userId: string,
      scope: OracleJobSession['scope'],
      excludeSessionId?: string,
    ): Promise<OracleJobSession | null> {
      let query = supabaseAdmin
        .from(SESSIONS)
        .select('*')
        .eq('user_id', userId)
        .eq('scope', scope)
        // 'failed' is terminal too but is not a record worth comparing against.
        .in('status', ['done', 'partial'])
        .order('completed_at', { ascending: false, nullsFirst: false })
        .limit(1)
      if (excludeSessionId) query = query.neq('id', excludeSessionId)
      const { data, error } = await query
      if (error) throw new Error(`findLatestCompletedSession: ${error.message}`)
      return (data?.[0] as OracleJobSession | undefined) ?? null
    },

    async loadProfiles(userId: string, profileIds: string[]): Promise<OracleProfile[]> {
      if (profileIds.length === 0) return []
      const { data, error } = await supabaseAdmin
        .from(PROFILES)
        .select('*')
        .eq('user_id', userId)
        .in('id', profileIds)
      if (error) throw new Error(`loadProfiles: ${error.message}`)
      return (data ?? []) as OracleProfile[]
    },

    async insertSession(row: SessionInsert): Promise<OracleJobSession> {
      const { data, error } = await supabaseAdmin.from(SESSIONS).insert(row).select('*').single()
      if (error) throw new Error(`insertSession: ${error.message}`)
      return data as OracleJobSession
    },

    async getSession(sessionId: string): Promise<OracleJobSession | null> {
      const { data, error } = await supabaseAdmin.from(SESSIONS).select('*').eq('id', sessionId).maybeSingle()
      if (error) throw new Error(`getSession: ${error.message}`)
      return (data as OracleJobSession | null) ?? null
    },

    async updateSession(sessionId: string, patch: SessionPatch): Promise<OracleJobSession | null> {
      const { data, error } = await supabaseAdmin
        .from(SESSIONS)
        .update(patch)
        .eq('id', sessionId)
        .select('*')
        .maybeSingle()
      if (error) throw new Error(`updateSession: ${error.message}`)
      return (data as OracleJobSession | null) ?? null
    },

    /**
     * Atomic claim. The WHERE clause carries both the free-lease predicate and
     * the attempt_count we read, so two workers that read the same row cannot
     * both win: Postgres re-evaluates the predicate after taking the row lock.
     */
    async claimLease(sessionId: string, leaseUntil: string, nowIso: string): Promise<OracleJobSession | null> {
      const { data: current, error: readError } = await supabaseAdmin
        .from(SESSIONS)
        .select('attempt_count,status')
        .eq('id', sessionId)
        .maybeSingle()
      if (readError) throw new Error(`claimLease read: ${readError.message}`)
      if (!current) return null

      const row = current as { attempt_count: number; status: string }
      if ((ORACLE_TERMINAL_STATUSES as readonly string[]).includes(row.status)) return null

      const { data, error } = await supabaseAdmin
        .from(SESSIONS)
        .update({
          lease_until: leaseUntil,
          last_heartbeat_at: nowIso,
          attempt_count: row.attempt_count + 1,
        })
        .eq('id', sessionId)
        .eq('attempt_count', row.attempt_count)
        .or(freeLeaseFilter(nowIso))
        .select('*')
        .maybeSingle()
      if (error) throw new Error(`claimLease: ${error.message}`)
      return (data as OracleJobSession | null) ?? null
    },

    async touchHeartbeat(sessionId: string, nowIso: string): Promise<void> {
      const { error } = await supabaseAdmin
        .from(SESSIONS)
        .update({ last_heartbeat_at: nowIso })
        .eq('id', sessionId)
      if (error) throw new Error(`touchHeartbeat: ${error.message}`)
    },

    async upsertComputations(rows: ComputationInsert[]): Promise<OracleComputation[]> {
      if (rows.length === 0) return []
      const { data, error } = await supabaseAdmin
        .from(COMPUTATIONS)
        .upsert(rows, { onConflict: 'session_id,system' })
        .select('*')
      if (error) throw new Error(`upsertComputations: ${error.message}`)
      return (data ?? []) as OracleComputation[]
    },

    async listComputations(sessionId: string): Promise<OracleComputation[]> {
      const { data, error } = await supabaseAdmin
        .from(COMPUTATIONS)
        .select('*')
        .eq('session_id', sessionId)
        .order('system', { ascending: true })
      if (error) throw new Error(`listComputations: ${error.message}`)
      return (data ?? []) as OracleComputation[]
    },

    async insertReadingIfAbsent(row: ReadingInsert): Promise<boolean> {
      const { error } = await supabaseAdmin.from(READINGS).insert(row)
      if (!error) return true
      if (error.code === UNIQUE_VIOLATION) return false
      throw new Error(`insertReadingIfAbsent: ${error.message}`)
    },

    async listReadings(sessionId: string): Promise<OracleReading[]> {
      const { data, error } = await supabaseAdmin
        .from(READINGS)
        .select('*')
        .eq('session_id', sessionId)
        .order('system', { ascending: true })
      if (error) throw new Error(`listReadings: ${error.message}`)
      return (data ?? []) as OracleReading[]
    },

    async insertVerdictIfAbsent(row: VerdictInsert): Promise<boolean> {
      const { error } = await supabaseAdmin.from(VERDICTS).insert(row)
      if (!error) return true
      if (error.code === UNIQUE_VIOLATION) return false
      throw new Error(`insertVerdictIfAbsent: ${error.message}`)
    },

    async listVerdicts(sessionId: string): Promise<OracleVerdict[]> {
      const { data, error } = await supabaseAdmin
        .from(VERDICTS)
        .select('*')
        .eq('session_id', sessionId)
        .order('reader_slug', { ascending: true })
      if (error) throw new Error(`listVerdicts: ${error.message}`)
      return (data ?? []) as OracleVerdict[]
    },

    async upsertConsensus(row: ConsensusUpsert): Promise<void> {
      // Only the keys present in the payload end up in the ON CONFLICT SET
      // list, so a finalize that writes ballot_tally leaves the create-time
      // system_agreement and deficiency_vector alone.
      const { error } = await supabaseAdmin.from(CONSENSUS).upsert(row, { onConflict: 'session_id' })
      if (error) throw new Error(`upsertConsensus: ${error.message}`)
    },

    async getConsensus(sessionId: string): Promise<OracleConsensus | null> {
      const { data, error } = await supabaseAdmin
        .from(CONSENSUS)
        .select('*')
        .eq('session_id', sessionId)
        .maybeSingle()
      if (error) throw new Error(`getConsensus: ${error.message}`)
      return (data as OracleConsensus | null) ?? null
    },

    async listStaleSessions(limit: number, staleBeforeIso: string, nowIso: string): Promise<OracleJobSession[]> {
      const { data, error } = await supabaseAdmin
        .from(SESSIONS)
        .select('*')
        .not('status', 'in', quotedList(ORACLE_TERMINAL_STATUSES))
        .or(`last_heartbeat_at.is.null,last_heartbeat_at.lt.${staleBeforeIso}`)
        .or(freeLeaseFilter(nowIso))
        .order('last_heartbeat_at', { ascending: true, nullsFirst: true })
        .limit(limit)
      if (error) throw new Error(`listStaleSessions: ${error.message}`)
      return (data ?? []) as OracleJobSession[]
    },
  }
}
