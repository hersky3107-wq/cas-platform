/**
 * Supabase backing for talisman_purchases + the integrated-session lookup.
 * Kept out of the talisman barrel: constructs the admin client at load time.
 */
import { supabaseAdmin } from '@/lib/supabase/server'
import type { OracleJobSession } from '../schema'
import {
  parseTalismanBuyPurpose,
  type TalismanBuyPurpose,
} from './entitlement'
import type { TalismanPurchasePort, TalismanPurchaseRow, TalismanSourcePort } from './purchase'
import { earliestIntegratedSessionId, isIntegratedTalismanSource } from './source-session'

const PURCHASES = 'talisman_purchases'
const SESSIONS = 'oracle_job_sessions'
const CONSENSUS = 'oracle_consensus'
const UNIQUE_VIOLATION = '23505'

export function createTalismanPurchaseStore(): TalismanPurchasePort {
  return {
    async find(userId, sessionId, purpose) {
      const { data, error } = await supabaseAdmin
        .from(PURCHASES)
        .select('user_id, session_id, purpose, credits_charged')
        .eq('user_id', userId)
        .eq('session_id', sessionId)
        .eq('purpose', purpose)
        .maybeSingle()
      if (error) throw new Error(`findTalismanPurchase: ${error.message}`)
      return (data as TalismanPurchaseRow | null) ?? null
    },

    async insert(row) {
      const { error } = await supabaseAdmin.from(PURCHASES).insert(row)
      if (!error) return 'inserted'
      if (error.code === UNIQUE_VIOLATION) return 'duplicate'
      throw new Error(`insertTalismanPurchase: ${error.message}`)
    },

    async list(userId, sessionId) {
      const { data, error } = await supabaseAdmin
        .from(PURCHASES)
        .select('user_id, session_id, purpose, credits_charged')
        .eq('user_id', userId)
        .eq('session_id', sessionId)
      if (error) throw new Error(`listTalismanPurchases: ${error.message}`)
      return (data ?? []) as TalismanPurchaseRow[]
    },
  }
}

export function createTalismanSourceStore(): TalismanSourcePort {
  return {
    async load(userId, sessionId) {
      const session = await loadIntegratedTalismanSession(userId, sessionId)
      return session ? { sessionId: session.id } : null
    },
  }
}

export async function loadIntegratedTalismanSession(
  userId: string,
  sessionId?: string | null,
): Promise<OracleJobSession | null> {
  let query = supabaseAdmin
    .from(SESSIONS)
    .select('*')
    .eq('user_id', userId)
    .eq('kind', 'personal')
    .eq('scope', 'combined')
    .eq('status', 'done')
  if (sessionId) {
    query = query.eq('id', sessionId)
  } else {
    query = query.order('completed_at', { ascending: false, nullsFirst: false }).limit(1)
  }
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`loadIntegratedTalismanSession: ${error.message}`)
  const session = (data as OracleJobSession | undefined) ?? null
  if (!session) return null

  const { data: consensus, error: consensusError } = await supabaseAdmin
    .from(CONSENSUS)
    .select('session_id')
    .eq('session_id', session.id)
    .maybeSingle()
  if (consensusError) throw new Error(`loadIntegratedTalismanSession consensus: ${consensusError.message}`)

  if (!isIntegratedTalismanSource(session, userId, consensus != null)) return null
  return session
}

export async function loadFirstIntegratedSessionId(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from(SESSIONS)
    .select('id, user_id, kind, scope, status, prompt_version, created_at')
    .eq('user_id', userId)
    .eq('kind', 'personal')
    .eq('scope', 'combined')
    .eq('status', 'done')
    .order('created_at', { ascending: true })
  if (error) throw new Error(`loadFirstIntegratedSessionId: ${error.message}`)
  const sessions = (data ?? []) as Array<{
    id: string
    user_id: string
    kind: string
    scope: string
    status: string
    prompt_version: string | null
    created_at: string
  }>
  if (sessions.length === 0) return null

  const { data: consensusRows, error: consensusError } = await supabaseAdmin
    .from(CONSENSUS)
    .select('session_id')
    .in(
      'session_id',
      sessions.map((row) => row.id),
    )
  if (consensusError) throw new Error(`loadFirstIntegratedSessionId consensus: ${consensusError.message}`)
  const withConsensus = new Set((consensusRows ?? []).map((row) => row.session_id as string))
  const eligible = sessions.filter((session) =>
    isIntegratedTalismanSource(session, userId, withConsensus.has(session.id)),
  )
  return earliestIntegratedSessionId(eligible)
}

export async function hasTalismanPurchase(
  userId: string,
  sessionId: string,
  purposeRaw: string | null,
): Promise<boolean> {
  const purpose = parseTalismanBuyPurpose(purposeRaw)
  const row = await createTalismanPurchaseStore().find(userId, sessionId, purpose)
  return row != null
}

export function purchasedPurposeSet(rows: readonly TalismanPurchaseRow[]): Set<TalismanBuyPurpose> {
  return new Set(rows.map((row) => row.purpose))
}
