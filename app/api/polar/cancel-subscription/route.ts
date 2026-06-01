import { NextResponse } from 'next/server'
import { polarClient } from '@/lib/payments/polar'
import { supabaseAdmin } from '@/lib/supabase/server'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

export async function POST(req: Request) {
  try {
    const missingSb = missingSupabaseEnv()
    if (missingSb) {
      return NextResponse.json({ error: `Server misconfigured: missing ${missingSb}` }, { status: 503 })
    }

    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { body = {} }

    const { user, error: authErr } = await resolveRouteAuth(req, body)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const { data: row } = await supabaseAdmin
      .from('subscriptions')
      .select('paypal_subscription_id, status, current_period_end')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!row || row.status !== 'active') {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 })
    }

    if (!row.paypal_subscription_id?.startsWith('polar:')) {
      return NextResponse.json({ error: 'Not a Polar subscription' }, { status: 400 })
    }

    const polarSubscriptionId = row.paypal_subscription_id.replace('polar:', '')

    await polarClient.subscriptions.cancel({ id: polarSubscriptionId })

    await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('user_id', user.id)

    return NextResponse.json({ success: true, creditsValidUntil: row.current_period_end ?? null })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[polar/cancel-subscription]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
