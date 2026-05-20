import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { isAdminEmail } from '@/lib/credits'
import type { AddCreditsOutcome, DeductCreditsOutcome } from '@/lib/credits'
import { supabaseAdmin } from '@/lib/supabase/server'

export type { AddCreditsOutcome, DeductCreditsOutcome } from '@/lib/credits'

const CREDITS_TABLES = ['users', 'profiles'] as const

export const WELCOME_CREDITS_AMOUNT = 30

export type EnsureWelcomeCreditsOutcome =
  | { granted: true; balance: number }
  | { granted: false; balance: number | null }

async function readUserCreditsRow(
  userId: string
): Promise<{ exists: boolean; credits: number | null }> {
  const { data: userRow, error } = await supabaseAdmin
    .from('users')
    .select('id, credits')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.warn('[credits] welcome users read failed:', error.message)
    return { exists: false, credits: null }
  }

  if (!userRow) {
    return { exists: false, credits: null }
  }

  return {
    exists: true,
    credits: typeof userRow.credits === 'number' ? userRow.credits : 0,
  }
}

/**
 * Grants 30 welcome credits once per user (tracked in welcome_credit_grants).
 * Inserts users row when missing; sets credits when an existing row still has 0.
 */
export async function ensureWelcomeCreditsForUser(
  userId: string,
  options?: { nickname?: string | null }
): Promise<EnsureWelcomeCreditsOutcome> {
  const nickname = options?.nickname?.trim() || null

  const { error: grantError } = await supabaseAdmin.from('welcome_credit_grants').insert({
    user_id: userId,
    credits_granted: WELCOME_CREDITS_AMOUNT,
  })

  if (grantError) {
    if (grantError.code === '23505') {
      const balance = await getCreditsBalance(supabaseAdmin, userId)
      return { granted: false, balance }
    }
    console.warn('[credits] welcome grant log failed:', grantError.message)
    const balance = await getCreditsBalance(supabaseAdmin, userId)
    return { granted: false, balance }
  }

  const userRow = await readUserCreditsRow(userId)

  if (userRow.exists && userRow.credits !== null && userRow.credits > 0) {
    await supabaseAdmin.from('welcome_credit_grants').delete().eq('user_id', userId)
    return { granted: false, balance: userRow.credits }
  }

  if (!userRow.exists) {
    const insertPayload: { id: string; credits: number; nickname?: string } = {
      id: userId,
      credits: WELCOME_CREDITS_AMOUNT,
    }
    if (nickname) insertPayload.nickname = nickname

    const { error: insertErr } = await supabaseAdmin.from('users').insert(insertPayload)
    if (insertErr) {
      console.warn('[credits] welcome users insert failed:', insertErr.message)
      await supabaseAdmin.from('welcome_credit_grants').delete().eq('user_id', userId)
      const balance = await getCreditsBalance(supabaseAdmin, userId)
      return { granted: false, balance }
    }
  } else {
    const updatePayload: { credits: number; nickname?: string } = {
      credits: WELCOME_CREDITS_AMOUNT,
    }
    if (nickname) updatePayload.nickname = nickname

    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update(updatePayload)
      .eq('id', userId)

    if (updateErr) {
      console.warn('[credits] welcome users update failed:', updateErr.message)
      await supabaseAdmin.from('welcome_credit_grants').delete().eq('user_id', userId)
      const balance = await getCreditsBalance(supabaseAdmin, userId)
      return { granted: false, balance }
    }

    const { data: profileRow } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle()

    if (profileRow) {
      const profilePayload: { credits: number; nickname?: string } = {
        credits: WELCOME_CREDITS_AMOUNT,
      }
      if (nickname) profilePayload.nickname = nickname
      await supabaseAdmin.from('profiles').update(profilePayload).eq('id', userId)
    }
  }

  const balance = await getCreditsBalance(supabaseAdmin, userId)
  return { granted: true, balance: balance ?? WELCOME_CREDITS_AMOUNT }
}

async function isAdminUser(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)
  if (error) {
    console.warn('[credits] admin user lookup failed:', error.message)
    return false
  }
  return isAdminEmail(data.user?.email)
}

async function readCreditsFromTable(
  table: (typeof CREDITS_TABLES)[number],
  userId: string
): Promise<{ balance: number | null; error: string | null }> {
  const { data, error } = await supabaseAdmin.from(table).select('credits').eq('id', userId).maybeSingle()

  if (error) {
    return { balance: null, error: error.message }
  }

  return { balance: typeof data?.credits === 'number' ? data.credits : 0, error: null }
}

/**
 * Reads `users.credits` (falls back to `profiles.credits`).
 * Returns null if both reads fail (credit enforcement skipped in dev).
 */
export async function getCreditsBalance(
  _supabase: SupabaseClient,
  userId: string
): Promise<number | null> {
  const users = await readCreditsFromTable('users', userId)
  if (users.balance !== null) return users.balance

  const profiles = await readCreditsFromTable('profiles', userId)
  if (profiles.balance !== null) return profiles.balance

  console.warn('[credits] balance read failed:', users.error ?? profiles.error)
  return null
}

export async function deductCreditsBalance(
  _supabase: SupabaseClient,
  userId: string,
  amount: number
): Promise<DeductCreditsOutcome> {
  if (await isAdminUser(userId)) {
    const balance = await getCreditsBalance(supabaseAdmin, userId)
    return { ok: true, balance, skipped: true }
  }

  const balance = await getCreditsBalance(supabaseAdmin, userId)
  if (balance === null) {
    return { ok: true, balance: null, skipped: true }
  }
  if (balance < amount) {
    return { ok: false, balance, reason: 'insufficient' }
  }
  const next = balance - amount

  for (const table of CREDITS_TABLES) {
    const { error } = await supabaseAdmin.from(table).update({ credits: next }).eq('id', userId)
    if (!error) {
      return { ok: true, balance: next }
    }
    console.warn(`[credits] deduct on ${table} failed:`, error.message)
  }

  return { ok: false, balance, reason: 'update_failed' }
}

/** Grant credits after payment (service role). Updates users + profiles when present. */
export async function addCreditsBalance(
  _supabase: SupabaseClient,
  userId: string,
  amount: number
): Promise<AddCreditsOutcome> {
  if (amount < 1) {
    return { ok: false, reason: 'update_failed' }
  }

  const current = await getCreditsBalance(supabaseAdmin, userId)
  if (current === null) {
    return { ok: false, reason: 'read_failed' }
  }

  const next = current + amount
  let updated = false

  for (const table of CREDITS_TABLES) {
    const { data: row } = await supabaseAdmin.from(table).select('id').eq('id', userId).maybeSingle()
    if (!row) continue

    const { error } = await supabaseAdmin.from(table).update({ credits: next }).eq('id', userId)
    if (!error) {
      updated = true
    } else {
      console.warn(`[credits] add on ${table} failed:`, error.message)
    }
  }

  if (!updated) {
    const { error: insertErr } = await supabaseAdmin
      .from('users')
      .upsert({ id: userId, credits: next }, { onConflict: 'id' })

    if (insertErr) {
      console.warn('[credits] users upsert failed:', insertErr.message)
      return { ok: false, reason: 'update_failed' }
    }
  }

  return { ok: true, balance: next }
}

export type CreditsBillingMode = 'subscription' | 'pay_as_you_go'

export type CreditsDisplayConfig = {
  billingMode: CreditsBillingMode
  percentCeiling: number
}

/**
 * Controls credit gauge visibility (subscription vs PAYG) and % denominator for warnings.
 * Defaults when users row is missing or columns unreadable.
 */
export async function getCreditsDisplayConfig(userId: string): Promise<CreditsDisplayConfig> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('credits_billing_mode, credits_percent_ceiling')
    .eq('id', userId)
    .maybeSingle()

  if (error || !data) {
    return { billingMode: 'pay_as_you_go', percentCeiling: 1000 }
  }

  const rawMode = data.credits_billing_mode as string | undefined
  const billingMode: CreditsBillingMode =
    rawMode === 'subscription' ? 'subscription' : 'pay_as_you_go'

  const ceilRaw = data.credits_percent_ceiling
  const percentCeiling =
    typeof ceilRaw === 'number' && Number.isFinite(ceilRaw) && ceilRaw >= 1 ? ceilRaw : 1000

  return { billingMode, percentCeiling }
}
