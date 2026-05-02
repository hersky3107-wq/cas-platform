import { NextResponse } from 'next/server'
import { getCreditsBalance } from '@/lib/credits'
import { createSupabaseWithToken } from '@/lib/supabase/server-client'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const token =
      typeof body?.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined

    if (!token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const supabase = createSupabaseWithToken(token)
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
