/**
 * CreditsPort backed by lib/credits-server.
 *
 * Kept out of the runner barrel: lib/credits-server is `server-only`, so
 * importing it from a unit test would fail. Tests use a fake port instead.
 *
 * Admin users are skipped by `deductCreditsBalance` rather than charged. The
 * runner records `credits_charged: 0` in that case, so the refund paths —
 * which all derive their amount from that column — correctly do nothing and
 * never hand an admin free credits.
 */
import { addCreditsBalance, deductCreditsBalance } from '@/lib/credits-server'
import { supabaseAdmin } from '@/lib/supabase/server'
import type { CreditsPort } from './types'

export function createCreditsPort(): CreditsPort {
  return {
    async charge(userId: string, amount: number, moduleName: string) {
      const outcome = await deductCreditsBalance(supabaseAdmin, userId, amount, moduleName)
      if (outcome.ok) {
        return { ok: true as const, balance: outcome.balance, skipped: outcome.skipped ?? false }
      }
      return {
        ok: false as const,
        reason: outcome.reason === 'insufficient' ? ('insufficient' as const) : ('error' as const),
        balance: outcome.balance,
      }
    },

    async refund(userId: string, amount: number) {
      if (amount <= 0) return
      await addCreditsBalance(supabaseAdmin, userId, amount)
    },
  }
}
