import { NextResponse } from 'next/server'
import { ensureWelcomeCreditsForUser } from '@/lib/credits-server'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'
import { supabaseAdmin } from '@/lib/supabase/server'

function detectLocaleFromHeader(acceptLanguage: string): string {
  const lang = acceptLanguage.toLowerCase()
  if (lang.includes('ko')) return 'ko'
  if (lang.includes('ja')) return 'ja'
  if (lang.includes('zh-tw') || lang.includes('zh-hk')) return 'zh-TW'
  if (lang.includes('fr')) return 'fr'
  if (lang.includes('ar')) return 'ar'
  return 'en'
}

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

    const authHeader = req.headers.get('authorization')
    const bearerToken =
      authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined
    const authBody: Record<string, unknown> = { ...(body ?? {}) }
    if (bearerToken) {
      authBody.supabaseAccessToken = bearerToken
    }

    const { user, error: authErr } = await resolveRouteAuth(req, authBody)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const meta = user.user_metadata as Record<string, unknown> | undefined
    let nickname = nicknameFromMetadata(meta)
    if (!nickname && user.email) {
      nickname = user.email.split('@')[0] ?? null
    }

    const result = await ensureWelcomeCreditsForUser(user.id, { nickname })

    const acceptLanguage = req.headers.get('accept-language') ?? ''
    const detectedLocale = detectLocaleFromHeader(acceptLanguage)
    if (detectedLocale !== 'en') {
      await supabaseAdmin
        .from('users')
        .update({ ui_locale: detectedLocale })
        .eq('id', user.id)
        .is('ui_locale', null)
    }

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
