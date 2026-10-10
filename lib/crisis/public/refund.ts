import type { SupabaseClient } from '@supabase/supabase-js'
import { CRISIS_DEEP_CREDITS } from '../credits'
import { DEEP_TIMEOUT_MS } from './policy'

export interface RefundResult {
  refunded: boolean
  already?: boolean
  reason?: string
}

export function isTimedOutRequest(
  request: { created_at: string; status: string },
  now = new Date(),
): boolean {
  if (request.status !== 'queued' && request.status !== 'running') return false
  const t = Date.parse(request.created_at)
  return Number.isFinite(t) && now.getTime() - t >= DEEP_TIMEOUT_MS
}

/**
 * Refund CRISIS_DEEP_CREDITS once for a user request (idempotent, record in crisis_unlocks).
 * Admin is exempt from credit charges, so admin doesn't receive credits, but the refund record is still written.
 */
export async function refundUserRequest(
  client: SupabaseClient,
  requestId: string,
  userId: string,
  regionId: number | null,
): Promise<RefundResult> {
  // 1. Idempotency check via crisis_unlocks
  const { data: existing, error: checkErr } = await client
    .from('crisis_unlocks')
    .select('id')
    .eq('kind', 'deep_refund')
    .eq('request_id', requestId)
    .maybeSingle()

  if (!checkErr && existing) {
    return { refunded: false, already: true, reason: 'already_refunded' }
  }

  // 2. Record in crisis_unlocks
  const { error: insertErr } = await client.from('crisis_unlocks').insert({
    user_id: userId,
    kind: 'deep_refund',
    request_id: requestId,
    region_id: regionId,
  })

  if (insertErr) {
    if (/duplicate|unique/i.test(insertErr.message)) {
      return { refunded: false, already: true, reason: 'already_refunded' }
    }
    // If request_id column is not in schema yet, fall back without request_id
    if (/request_id|column/i.test(insertErr.message)) {
      const fallback = await client.from('crisis_unlocks').insert({
        user_id: userId,
        kind: 'deep_refund',
        region_id: regionId,
      })
      if (fallback.error && !/duplicate|unique/i.test(fallback.error.message)) {
        console.warn('[refund] fallback insert:', fallback.error.message)
      }
    } else {
      console.warn('[refund] record unlock error:', insertErr.message)
    }
  }

  // Clean up any uncompleted unlock record for this region so user doesn't have an unearned card
  if (regionId != null) {
    await client
      .from('crisis_unlocks')
      .delete()
      .eq('user_id', userId)
      .eq('kind', 'deep')
      .eq('region_id', regionId)
      .is('run_id', null)
  }

  // 3. Admin is exempt from credit balance changes
  const { isUserAdmin } = await import('./auth')
  const admin = await isUserAdmin(userId)
  if (!admin) {
    const { addCreditsBalance } = await import('@/lib/credits-server')
    await addCreditsBalance(client, userId, CRISIS_DEEP_CREDITS)
  }

  return { refunded: true }
}

/**
 * Scan for queued/running requests older than 60 minutes, mark them failed, and refund.
 * Used on page load and in limits check.
 */
export async function refundTimedOutUserRequests(
  client: SupabaseClient,
  userId?: string,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - DEEP_TIMEOUT_MS).toISOString()
  let query = client
    .from('crisis_engine_requests')
    .select('id, requested_by, region_id, created_at, status')
    .in('status', ['queued', 'running'])
    .lte('created_at', cutoff)

  if (userId) {
    query = query.eq('requested_by', userId)
  }

  const { data, error } = await query.limit(50)
  if (error) {
    if (/crisis_engine_requests|does not exist/i.test(error.message)) return 0
    throw new Error(`refundTimedOutUserRequests query failed: ${error.message}`)
  }

  let count = 0
  for (const row of data ?? []) {
    const finishedAt = now.toISOString()
    await client
      .from('crisis_engine_requests')
      .update({
        status: 'failed',
        error: 'timeout_60m',
        finished_at: finishedAt,
      })
      .eq('id', row.id)

    if (row.requested_by) {
      await refundUserRequest(
        client,
        String(row.id),
        String(row.requested_by),
        row.region_id == null ? null : Number(row.region_id),
      )
      count++
    }
  }

  return count
}
