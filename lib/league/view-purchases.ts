import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import {
  RECORD_ROOM_PURCHASE_ROUND_LIMIT,
  type LeagueViewProduct,
  type RecordRoomWindow,
} from './view-purchase-policy'

/**
 * Store for `league_view_purchases` (migration 20260914000004).
 *
 * Same money columns as `league_generation_jobs`: a live row is
 * charged AND NOT refunded. Leaderboard is unique-live per user
 * (partial unique index). Record room allows many rows; the latest
 * live row is the window the GET path serves.
 */

const TABLE = 'league_view_purchases'
const UNIQUE_VIOLATION = '23505'

export type LeagueViewPurchase = {
  id: string
  user_id: string
  product: LeagueViewProduct
  charged: boolean
  charged_cost: number
  deduct_skipped: boolean
  refunded: boolean
  as_of: string | null
  round_limit: number | null
  created_at: string
}

export type ViewPurchaseInsert = {
  user_id: string
  product: LeagueViewProduct
  charged: boolean
  charged_cost: number
  deduct_skipped: boolean
  as_of?: string | null
  round_limit?: number | null
}

export type InsertViewPurchaseResult =
  | { ok: true; row: LeagueViewPurchase }
  | { ok: false; reason: 'already_owned' }

export async function findLiveViewPurchase(
  userId: string,
  product: LeagueViewProduct
): Promise<LeagueViewPurchase | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('product', product)
    .eq('charged', true)
    .eq('refunded', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`findLiveViewPurchase: ${error.message}`)
  return (data as LeagueViewPurchase | null) ?? null
}

export async function hasLeaderboardAccess(userId: string): Promise<boolean> {
  const row = await findLiveViewPurchase(userId, 'leaderboard')
  return row !== null
}

export async function latestRecordRoomWindow(userId: string): Promise<RecordRoomWindow | null> {
  const row = await findLiveViewPurchase(userId, 'record_room')
  if (!row || !row.as_of) return null
  return {
    asOf: row.as_of,
    roundLimit: row.round_limit ?? RECORD_ROOM_PURCHASE_ROUND_LIMIT,
  }
}

export async function slideRecordRoomWindow(id: string, asOf: string, roundLimit: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({ as_of: asOf, round_limit: roundLimit })
    .eq('id', id)
    .eq('product', 'record_room')
    .eq('charged', true)
    .eq('refunded', false)
  if (error) throw new Error(`slideRecordRoomWindow: ${error.message}`)
}

export async function insertViewPurchase(input: ViewPurchaseInsert): Promise<InsertViewPurchaseResult> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({
      user_id: input.user_id,
      product: input.product,
      charged: input.charged,
      charged_cost: input.charged_cost,
      deduct_skipped: input.deduct_skipped,
      refunded: false,
      as_of: input.as_of ?? null,
      round_limit: input.round_limit ?? null,
    })
    .select('*')
    .single()
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: 'already_owned' }
    throw new Error(`insertViewPurchase: ${error.message}`)
  }
  return { ok: true, row: data as LeagueViewPurchase }
}
