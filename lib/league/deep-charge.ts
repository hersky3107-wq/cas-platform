import 'server-only'

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { addCreditsBalance, deductCreditsBalance } from '@/lib/credits-server'
import type { DeductCreditsOutcome } from '@/lib/credits'

/**
 * Deduct-then-refund helper for league deep analysis.
 * Mirrors generate-stream (charge before work, 402 = no charge) and adds
 * an explicit refund when the run fails before producing usable output.
 */

export async function chargeDeep(
  userId: string,
  cost: number,
  moduleName: string
): Promise<{ ok: true; deduct: DeductCreditsOutcome & { ok: true } } | { ok: false; response: NextResponse }> {
  const deduct = await deductCreditsBalance(supabaseAdmin, userId, cost, moduleName)
  if (!deduct.ok) {
    const insufficient = deduct.reason === 'insufficient'
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: insufficient ? 'Insufficient credits' : 'Could not update credits',
          balance: deduct.balance,
          required: cost,
        },
        { status: insufficient ? 402 : 500 }
      ),
    }
  }
  return { ok: true, deduct }
}

export async function refundDeep(userId: string, cost: number, deduct: DeductCreditsOutcome): Promise<void> {
  if (!deduct.ok) return
  if (deduct.skipped) return
  await addCreditsBalance(supabaseAdmin, userId, cost)
}
