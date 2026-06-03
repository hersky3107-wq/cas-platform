import { NextResponse } from 'next/server'
import { deductCreditsBalance } from '@/lib/credits-server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

export async function POST(req: Request) {
  try {
    const missing = missingSupabaseEnv()
    if (missing) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missing}` },
        { status: 503 }
      )
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const amount =
      typeof body.amount === 'number'
        ? body.amount
        : typeof body.amount === 'string'
          ? Number(body.amount)
          : NaN

    if (!Number.isFinite(amount) || amount < 1) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
    }

    const { user, error: authErr } = await resolveRouteAuth(req, body)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const deduct = await deductCreditsBalance(supabaseAdmin, user.id, amount, 'api_deduct')
    if (!deduct.ok) {
      const insufficient = deduct.reason === 'insufficient'
      return NextResponse.json(
        {
          error: insufficient ? 'Insufficient credits' : 'Could not update credits',
          balance: deduct.balance,
          required: amount,
        },
        { status: insufficient ? 402 : 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      balance: deduct.balance,
      skipped: deduct.skipped ?? false,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
