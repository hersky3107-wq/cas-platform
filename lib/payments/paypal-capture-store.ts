import type { SupabaseClient } from '@supabase/supabase-js'
import { TOPUP_PLAN_ID } from '@/lib/payments/topup'

export async function isPayPalOrderRecorded(
  supabase: SupabaseClient,
  paypalOrderId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('paypal_credit_purchases')
    .select('paypal_order_id')
    .eq('paypal_order_id', paypalOrderId)
    .maybeSingle()

  if (error) {
    console.warn('[paypal] purchase lookup failed:', error.message)
    return false
  }

  return Boolean(data?.paypal_order_id)
}

export async function recordPayPalPurchase(
  supabase: SupabaseClient,
  row: {
    paypalOrderId: string
    userId: string
    planId: string
    creditsGranted: number
    amountUsd: number
  }
): Promise<{ ok: true } | { ok: false; duplicate: boolean }> {
  const { error } = await supabase.from('paypal_credit_purchases').insert([
    {
      paypal_order_id: row.paypalOrderId,
      user_id: row.userId,
      plan_id: row.planId,
      credits_granted: row.creditsGranted,
      amount_usd: row.amountUsd,
    },
  ])

  if (error) {
    if (error.code === '23505') {
      return { ok: false, duplicate: true }
    }
    console.warn('[paypal] purchase insert failed:', error.message)
    return { ok: false, duplicate: false }
  }

  return { ok: true }
}

export async function recordPayPalTopUpPurchase(
  supabase: SupabaseClient,
  row: {
    paypalOrderId: string
    userId: string
    creditsGranted: number
    amountUsd: number
  }
): Promise<{ ok: true } | { ok: false; duplicate: boolean }> {
  return recordPayPalPurchase(supabase, {
    paypalOrderId: row.paypalOrderId,
    userId: row.userId,
    planId: TOPUP_PLAN_ID,
    creditsGranted: row.creditsGranted,
    amountUsd: row.amountUsd,
  })
}
