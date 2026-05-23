import 'server-only'

import { addCreditsBalance } from '@/lib/credits-server'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function applyTopUpCredits(
  userId: string,
  creditsToAdd: number
): Promise<{ ok: true; balance: number } | { ok: false; reason: string }> {
  if (creditsToAdd < 1) {
    return { ok: false, reason: 'invalid_credits' }
  }

  const grant = await addCreditsBalance(supabaseAdmin, userId, creditsToAdd)
  if (!grant.ok) {
    return { ok: false, reason: grant.reason ?? 'update_failed' }
  }

  const expiresAt = new Date()
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 90)

  const { error } = await supabaseAdmin
    .from('users')
    .update({
      credits_billing_mode: 'topup',
      topup_expires_at: expiresAt.toISOString(),
    })
    .eq('id', userId)

  if (error) {
    console.warn('[topup] users billing update failed:', error.message)
    return { ok: false, reason: 'billing_update_failed' }
  }

  return { ok: true, balance: grant.balance }
}
