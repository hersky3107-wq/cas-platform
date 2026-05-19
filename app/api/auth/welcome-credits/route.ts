import { NextResponse } from 'next/server'
import { ensureWelcomeCreditsForUser } from '@/lib/credits-server'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

function nicknameFromMetadata(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null
  const nickname = typeof metadata.nickname === 'string' ? metadata.nickname.trim() : ''
  if (nickname) return nickname
  const fullName = typeof metadata.full_name === 'string' ? metadata.full_name.trim() : ''
  if (fullName) return fullName
  const name = typeof metadata.name === 'string' ? metadata.name.trim() : ''
  if (name) return name
  return null
}

export async function POST(req: Request) {
  try {
    const missing = missingSupabaseEnv()
    if (missing) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missing}` },
        { status: 503 }
      )
    }

    let body: Record<string, unknown> | null = null
    try {
      body = await req.json()
    } catch {
      body = null
    }

    const { user, error: authErr } = await resolveRouteAuth(req, body ?? undefined)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const meta = user.user_metadata as Record<string, unknown> | undefined
    let nickname = nicknameFromMetadata(meta)
    if (!nickname && user.email) {
      nickname = user.email.split('@')[0] ?? null
    }

    const result = await ensureWelcomeCreditsForUser(user.id, { nickname })

    return NextResponse.json({
      ok: true,
      granted: result.granted,
      balance: result.balance,
      welcomeCredits: result.granted ? 30 : 0,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[auth/welcome-credits]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
