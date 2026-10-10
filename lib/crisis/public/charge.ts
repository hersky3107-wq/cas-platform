import { NextResponse } from 'next/server'
import { deductCreditsBalance } from '@/lib/credits-server'
import { supabaseAdmin } from '@/lib/supabase/server'

/** Same deduct-before-work gate as league generate-stream / deep-charge. */
export async function chargeCrisis(
  userId: string,
  cost: number,
  moduleName: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
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
        { status: insufficient ? 402 : 500 },
      ),
    }
  }
  return { ok: true }
}
