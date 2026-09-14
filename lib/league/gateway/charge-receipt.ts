import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Durable one-consume charge receipt, backed by `league_gateway_receipts`
 * (migration 20260914000001) so the gateway does not double-charge when the
 * gateway call and the generate call land on DIFFERENT serverless isolates.
 *
 * The previous implementation was an in-process Map: on Vercel the receipt
 * written by the gateway's isolate was invisible to the generate route's
 * isolate, the lookup missed, and the user was charged a second time. That
 * was a LIVE double-charge bug, not a hypothetical.
 *
 * CONSUME IS ONE-SHOT ACROSS PROCESSES: a single conditional UPDATE
 * (`consumed_at IS NULL AND expires_at > now`, plus the user/instrument/
 * horizon binding). Postgres re-evaluates the predicate under the row lock,
 * so two racing consumers cannot both see a row come back — the same
 * atomic-conditional-UPDATE trick the oracle lease claim uses.
 *
 * Same product semantics as before: 5-minute TTL, bound to
 * (user, instrument, horizon), one consume.
 *
 * `db` is injectable for unit tests; runtime callers omit it and get
 * supabaseAdmin (lazy import so importing this module never constructs the
 * client during tests).
 */

const TTL_MS = 5 * 60 * 1000

const RECEIPTS = 'league_gateway_receipts'

/** Structural subset of SupabaseClient the two functions need. */
export type ReceiptDb = Pick<SupabaseClient, 'from'>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function defaultDb(): Promise<ReceiptDb> {
  const { supabaseAdmin } = await import('@/lib/supabase/server')
  return supabaseAdmin
}

/**
 * Writes the receipt row and returns its id (the token the client carries
 * from the gateway response to the generate call). Throws on DB failure —
 * the gateway must not answer "ready + you were charged" without a receipt
 * that the generate call will honor.
 */
export async function issueGatewayReceipt(
  userId: string,
  instrument: string,
  horizon: string,
  db?: ReceiptDb,
  now: number = Date.now()
): Promise<string> {
  const client = db ?? (await defaultDb())
  const { data, error } = await client
    .from(RECEIPTS)
    .insert({
      user_id: userId,
      instrument,
      horizon,
      expires_at: new Date(now + TTL_MS).toISOString(),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`issueGatewayReceipt: ${error?.message ?? 'no row'}`)
  return (data as { id: string }).id
}

/**
 * True exactly once per receipt: the conditional UPDATE only returns a row
 * for the first caller that matches user+instrument+horizon on an unexpired,
 * unconsumed receipt. Everything else — wrong binding, expired, already
 * consumed, malformed id — is false, and false means "charge normally".
 */
export async function consumeGatewayReceipt(
  id: string,
  userId: string,
  instrument: string,
  horizon: string,
  db?: ReceiptDb,
  now: number = Date.now()
): Promise<boolean> {
  if (!UUID_RE.test(id)) return false
  const client = db ?? (await defaultDb())
  const nowIso = new Date(now).toISOString()
  const { data, error } = await client
    .from(RECEIPTS)
    .update({ consumed_at: nowIso })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('instrument', instrument)
    .eq('horizon', horizon)
    .is('consumed_at', null)
    .gt('expires_at', nowIso)
    .select('id')
  if (error) throw new Error(`consumeGatewayReceipt: ${error.message}`)
  return Array.isArray(data) && data.length === 1
}
