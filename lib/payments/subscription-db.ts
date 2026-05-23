import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import {
  creditsForSubscriptionPlan,
  type SubscriptionPlanType,
} from '@/lib/payments/subscription-plans'
import { setCreditsBalance } from '@/lib/credits-server'

export type SubscriptionRowStatus = 'pending' | 'active' | 'cancelled' | 'suspended' | 'expired'

export type SubscriptionRow = {
  id: string
  user_id: string
  paypal_subscription_id: string
  plan_type: SubscriptionPlanType
  status: SubscriptionRowStatus
  nickname: string | null
  current_period_end?: string | null
  created_at?: string
  updated_at?: string
}

async function resolveNickname(userId: string, email?: string | null): Promise<string | null> {
  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('nickname')
    .eq('id', userId)
    .maybeSingle()

  const fromUsers =
    typeof userRow?.nickname === 'string' && userRow.nickname.trim()
      ? userRow.nickname.trim()
      : null
  if (fromUsers) return fromUsers

  const { data: authData } = await supabaseAdmin.auth.admin.getUserById(userId)
  const meta = authData.user?.user_metadata as Record<string, unknown> | undefined
  const fromMeta =
    typeof meta?.nickname === 'string' && meta.nickname.trim() ? meta.nickname.trim() : null
  if (fromMeta) return fromMeta

  if (email) {
    const local = email.split('@')[0]?.trim()
    if (local) return local
  }

  return null
}

export async function upsertSubscriptionRow(params: {
  userId: string
  paypalSubscriptionId: string
  planType: SubscriptionPlanType
  status: SubscriptionRowStatus
  email?: string | null
  currentPeriodEnd?: string | null
}): Promise<{ ok: true; row: SubscriptionRow } | { ok: false; error: string }> {
  const nickname = await resolveNickname(params.userId, params.email)
  const now = new Date().toISOString()

  const row: Record<string, unknown> = {
    user_id: params.userId,
    paypal_subscription_id: params.paypalSubscriptionId,
    plan_type: params.planType,
    status: params.status,
    nickname,
    updated_at: now,
  }
  if (params.currentPeriodEnd !== undefined) {
    row.current_period_end = params.currentPeriodEnd
  }

  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .upsert(row, { onConflict: 'user_id' })
    .select('*')
    .single()

  if (error) {
    console.warn('[subscriptions] upsert failed:', error.message)
    return { ok: false, error: error.message }
  }

  return { ok: true, row: data as SubscriptionRow }
}

export async function updateSubscriptionStatusByPaypalId(
  paypalSubscriptionId: string,
  status: SubscriptionRowStatus
): Promise<{ ok: true; row: SubscriptionRow } | { ok: false; error: string }> {
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .update({ status, updated_at: now })
    .eq('paypal_subscription_id', paypalSubscriptionId)
    .select('*')
    .maybeSingle()

  if (error) {
    console.warn('[subscriptions] status update failed:', error.message)
    return { ok: false, error: error.message }
  }

  if (!data) {
    return { ok: false, error: 'Subscription not found' }
  }

  return { ok: true, row: data as SubscriptionRow }
}

export async function getSubscriptionForUser(
  userId: string
): Promise<
  | Pick<
      SubscriptionRow,
      'plan_type' | 'status' | 'paypal_subscription_id' | 'current_period_end'
    >
  | null
> {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('plan_type, status, paypal_subscription_id, current_period_end')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.warn('[subscriptions] user lookup failed:', error.message)
    return null
  }

  if (!data) return null
  return data as Pick<
    SubscriptionRow,
    'plan_type' | 'status' | 'paypal_subscription_id' | 'current_period_end'
  >
}

export async function findSubscriptionByPaypalId(
  paypalSubscriptionId: string
): Promise<SubscriptionRow | null> {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('paypal_subscription_id', paypalSubscriptionId)
    .maybeSingle()

  if (error) {
    console.warn('[subscriptions] lookup failed:', error.message)
    return null
  }

  return (data as SubscriptionRow | null) ?? null
}

/** Set user credits to plan allowance and mark billing mode as subscription. */
export async function applySubscriptionCredits(
  userId: string,
  planType: SubscriptionPlanType
): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const amount = creditsForSubscriptionPlan(planType)
  const result = await setCreditsBalance(userId, amount, 'subscription')
  if (!result.ok) {
    return { ok: false, error: result.reason ?? 'update_failed' }
  }
  return { ok: true, balance: result.balance }
}

export async function activateSubscriptionForUser(params: {
  userId: string
  paypalSubscriptionId: string
  planType: SubscriptionPlanType
  email?: string | null
  currentPeriodEnd?: string | null
}): Promise<
  | { ok: true; balance: number; subscription: SubscriptionRow }
  | { ok: false; error: string }
> {
  const upsert = await upsertSubscriptionRow({
    userId: params.userId,
    paypalSubscriptionId: params.paypalSubscriptionId,
    planType: params.planType,
    status: 'active',
    email: params.email,
    currentPeriodEnd: params.currentPeriodEnd ?? null,
  })

  if (!upsert.ok) {
    return { ok: false, error: upsert.error }
  }

  const credits = await applySubscriptionCredits(params.userId, params.planType)
  if (!credits.ok) {
    return { ok: false, error: credits.error }
  }

  return { ok: true, balance: credits.balance, subscription: upsert.row }
}
