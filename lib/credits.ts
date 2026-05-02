import type { SupabaseClient } from '@supabase/supabase-js'

export const COMPARE_SYSTEM_PROMPT =
  'Respond in 5-7 sentences. Be direct and clear. Maximum 150 words.'

/** 3 AIs = 10, 4 = 12, 5 = 14, 6 = 16 (also n=1→6, n=2→8). */
export function creditsPerMessage(aiCount: number): number {
  if (aiCount < 1 || aiCount > 6) {
    throw new Error('Select between 1 and 6 AIs.')
  }
  return 4 + aiCount * 2
}

/**
 * Reads `profiles.credits` for the user. Returns null if the read fails (e.g. table/column missing),
 * in which case credit enforcement is skipped so local dev still works.
 */
export async function getCreditsBalance(
  supabase: SupabaseClient,
  userId: string
): Promise<number | null> {
  const { data, error } = await supabase.from('profiles').select('credits').eq('id', userId).maybeSingle()

  if (error) {
    console.warn('[credits] balance read failed:', error.message)
    return null
  }

  return typeof data?.credits === 'number' ? data.credits : 0
}

export type DeductCreditsOutcome =
  | { ok: true; balance: number | null; skipped?: boolean }
  | { ok: false; balance: number; reason: 'insufficient' | 'update_failed' }

export async function deductCreditsBalance(
  supabase: SupabaseClient,
  userId: string,
  amount: number
): Promise<DeductCreditsOutcome> {
  const balance = await getCreditsBalance(supabase, userId)
  if (balance === null) {
    return { ok: true, balance: null, skipped: true }
  }
  if (balance < amount) {
    return { ok: false, balance, reason: 'insufficient' }
  }
  const next = balance - amount
  const { error } = await supabase.from('profiles').update({ credits: next }).eq('id', userId)
  if (error) {
    console.warn('[credits] deduct failed:', error.message)
    return { ok: false, balance, reason: 'update_failed' }
  }
  return { ok: true, balance: next }
}
