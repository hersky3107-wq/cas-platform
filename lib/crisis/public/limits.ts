import type { SupabaseClient } from '@supabase/supabase-js'
import { MAX_ACTIVE_USER_REQUESTS, MAX_DAILY_USER_REQUESTS } from './policy'
import { refundTimedOutUserRequests } from './refund'

export interface LimitCheckResult {
  allowed: boolean
  reason?: 'active_request_exists' | 'daily_limit_exceeded'
  message?: string
}

export function evaluateUserLimits(opts: {
  isAdmin: boolean
  activeCount: number
  dailyCount: number
}): LimitCheckResult {
  if (opts.isAdmin) return { allowed: true }
  if (opts.activeCount >= MAX_ACTIVE_USER_REQUESTS) {
    return {
      allowed: false,
      reason: 'active_request_exists',
      message: '이미 진행 중인 분석 요청이 있습니다.',
    }
  }
  if (opts.dailyCount >= MAX_DAILY_USER_REQUESTS) {
    return {
      allowed: false,
      reason: 'daily_limit_exceeded',
      message: '하루 최대 3회까지 분석을 요청할 수 있습니다.',
    }
  }
  return { allowed: true }
}

export async function enforceUserLimits(
  client: SupabaseClient,
  userId: string,
  email?: string | null,
  now = new Date(),
): Promise<LimitCheckResult> {
  const { isUserAdmin } = await import('./auth')
  const admin = await isUserAdmin(userId, email)
  if (admin) return { allowed: true }

  // Clean up any timed-out requests first so they don't block the active limit
  await refundTimedOutUserRequests(client, userId, now)

  const { count: activeCount, error: activeErr } = await client
    .from('crisis_engine_requests')
    .select('id', { count: 'exact', head: true })
    .eq('requested_by', userId)
    .in('status', ['queued', 'running'])
  if (activeErr) throw new Error(`limits active check: ${activeErr.message}`)

  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
  const { count: dailyCount, error: dailyErr } = await client
    .from('crisis_engine_requests')
    .select('id', { count: 'exact', head: true })
    .eq('requested_by', userId)
    .eq('scope', 'region')
    .gte('created_at', startOfDay)
  if (dailyErr) throw new Error(`limits daily check: ${dailyErr.message}`)

  return evaluateUserLimits({
    isAdmin: admin,
    activeCount: activeCount ?? 0,
    dailyCount: dailyCount ?? 0,
  })
}
