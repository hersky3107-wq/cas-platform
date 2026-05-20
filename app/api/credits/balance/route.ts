import { NextResponse } from 'next/server'
import { getCreditsBalance, getCreditsDisplayConfig } from '@/lib/credits-server'
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

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const { user, supabase } = await resolveRouteAuth(req, body ?? undefined)
    if (!user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const balance = await getCreditsBalance(supabase, user.id)
    const display = await getCreditsDisplayConfig(user.id)

    return NextResponse.json({
      balance,
      billingMode: display.billingMode,
      percentCeiling: display.percentCeiling,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
