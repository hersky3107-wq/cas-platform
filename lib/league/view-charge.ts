import 'server-only'

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { addCreditsBalance, deductCreditsBalance } from '@/lib/credits-server'
import {
  creditsForLeagueLeaderboard,
  creditsForLeagueRecordRoom,
  LEAGUE_LEADERBOARD_MODULE,
  LEAGUE_RECORD_ROOM_MODULE,
} from './credits'
import { RECORD_ROOM_PURCHASE_ROUND_LIMIT, type LeagueViewProduct } from './view-purchase-policy'
import {
  findLiveViewPurchase,
  insertViewPurchase,
  slideRecordRoomWindow,
  type LeagueViewPurchase,
} from './view-purchases'

/**
 * Charge-then-receipt for a view surface. Mirrors generate's
 * already-paid short-circuit and unique-violation refund:
 *   * existing live row + not refresh → no charge
 *   * charge → insert; unique (leaderboard race) → refund the extra deduction
 */
export async function purchaseLeagueView(params: {
  userId: string
  product: LeagueViewProduct
  refresh?: boolean
}): Promise<
  | { ok: true; purchase: LeagueViewPurchase | null; charged: number; balance: number | null }
  | { ok: false; response: NextResponse }
> {
  const cost = params.product === 'leaderboard' ? creditsForLeagueLeaderboard() : creditsForLeagueRecordRoom()
  const moduleName = params.product === 'leaderboard' ? LEAGUE_LEADERBOARD_MODULE : LEAGUE_RECORD_ROOM_MODULE

  if (!params.refresh) {
    const existing = await findLiveViewPurchase(params.userId, params.product)
    if (existing) return { ok: true, purchase: existing, charged: 0, balance: null }
  }

  const deduct = await deductCreditsBalance(supabaseAdmin, params.userId, cost, moduleName)
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

  const charged = deduct.skipped !== true
  const now = new Date().toISOString()

  if (params.refresh && params.product === 'record_room') {
    const existing = await findLiveViewPurchase(params.userId, 'record_room')
    if (existing) {
      await slideRecordRoomWindow(existing.id, now, RECORD_ROOM_PURCHASE_ROUND_LIMIT)
      return {
        ok: true,
        purchase: { ...existing, as_of: now, round_limit: RECORD_ROOM_PURCHASE_ROUND_LIMIT },
        charged: charged ? cost : 0,
        balance: typeof deduct.balance === 'number' ? deduct.balance : null,
      }
    }
  }

  const inserted = await insertViewPurchase({
    user_id: params.userId,
    product: params.product,
    charged,
    charged_cost: charged ? cost : 0,
    deduct_skipped: deduct.skipped === true,
    as_of: params.product === 'record_room' ? now : null,
    round_limit: params.product === 'record_room' ? RECORD_ROOM_PURCHASE_ROUND_LIMIT : null,
  })

  if (!inserted.ok) {
    if (charged) await addCreditsBalance(supabaseAdmin, params.userId, cost)
    const existing = await findLiveViewPurchase(params.userId, params.product)
    return { ok: true, purchase: existing, charged: 0, balance: typeof deduct.balance === 'number' ? deduct.balance : null }
  }

  return {
    ok: true,
    purchase: inserted.row,
    charged: charged ? cost : 0,
    balance: typeof deduct.balance === 'number' ? deduct.balance : null,
  }
}
