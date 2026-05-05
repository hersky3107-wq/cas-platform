import { NextResponse } from 'next/server'
import { getCreditsBalance } from '@/lib/credits'
import { createSupabaseRouteAuthClient } from '@/lib/supabase/route-auth'

export async function POST(req: Request) {
  try {
    void (await req.json().catch(() => null)) // body not required; keep API signature stable
    const supabase = await createSupabaseRouteAuthClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()
    if (error || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const balance = await getCreditsBalance(supabase, user.id)

    return NextResponse.json({ balance })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
