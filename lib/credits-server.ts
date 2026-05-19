import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { isAdminEmail } from '@/lib/credits'
import type { AddCreditsOutcome, DeductCreditsOutcome } from '@/lib/credits'
import { supabaseAdmin } from '@/lib/supabase/server'

export type { AddCreditsOutcome, DeductCreditsOutcome } from '@/lib/credits'

const CREDITS_TABLES = ['users', 'profiles'] as const

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
