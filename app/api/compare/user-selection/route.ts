import { NextResponse } from 'next/server'
import { createSupabaseWithToken } from '@/lib/supabase/server-client'
import { MODEL_BY_PROVIDER, type AiProviderName } from '@/lib/ai/router'

/**
 * Saves a compare-mode pick (e.g. "Best answer" bar) to user_selections.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const providerRaw = typeof body.selectedProvider === 'string' ? body.selectedProvider : ''
    const token =
      typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined

    if (!token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    if (!sessionId || !providerRaw) {
      return NextResponse.json({ error: 'sessionId and selectedProvider are required' }, { status: 400 })
    }

    const provider = providerRaw as AiProviderName
    const model = MODEL_BY_PROVIDER[provider]

    const supabase = createSupabaseWithToken(token)
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const { data: sess } = await supabase
      .from('sessions')
      .select('id, mode')
      .eq('id', sessionId)
      .maybeSingle()

    if (
      !sess ||
      (sess.mode !== 'compare' && sess.mode !== 'custom' && sess.mode !== 'persona')
    ) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 400 })
    }

    const createdAt = new Date().toISOString()
    const bestAnswerCategory =
      sess.mode === 'persona' ? 'persona_best_answer' : 'compare_best_answer'

    const primary = {
      session_id: sessionId,
      user_id: user.id,
      selected_ai_provider: provider,
      selected_ai_model: model,
      category: bestAnswerCategory,
      created_at: createdAt,
    }

    const { error: e1 } = await supabase.from('user_selections').insert([primary])
    if (!e1) {
      return NextResponse.json({ ok: true })
    }

    const fallback = {
      session_id: sessionId,
      user_id: user.id,
      selected_ai_name: provider,
      selected_ai_provider: provider,
      selected_ai_model: model,
      category: bestAnswerCategory,
    }

    const { error: e2 } = await supabase.from('user_selections').insert([fallback])
    if (!e2) {
      return NextResponse.json({ ok: true })
    }

    const { error: e3 } = await supabase.from('user_selections').insert([
      {
        session_id: sessionId,
        selected_ai_name: provider,
      },
    ])

    if (e3) {
      console.warn('[compare/user-selection]', e1.message, e2.message, e3.message)
      return NextResponse.json({ error: e3.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
