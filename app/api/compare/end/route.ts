import { NextResponse } from 'next/server'
import { createSupabaseWithToken } from '@/lib/supabase/server-client'
import { supabaseAdmin } from '@/lib/supabase/server'
import { createSupabaseRouteAuthClient } from '@/lib/supabase/route-auth'
import { MODEL_BY_PROVIDER, type AiProviderName } from '@/lib/ai/router'

/**
 * End-of-session: best-AI pick + session_results (and user_selections for analytics).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const winner = typeof body.winner === 'string' ? body.winner : ''
    const token =
      typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined
    if (!sessionId || !winner) {
      return NextResponse.json({ error: 'sessionId and winner are required' }, { status: 400 })
    }

    const supabaseAuth = token
      ? createSupabaseWithToken(token)
      : await createSupabaseRouteAuthClient()
    const supabase = supabaseAdmin
    const {
      data: { user },
      error: authErr,
    } = await supabaseAuth.auth.getUser()
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

    const provider = winner as AiProviderName
    const model = MODEL_BY_PROVIDER[provider]
    const createdAt = new Date().toISOString()
    const sessionResultCategory = sess.mode === 'persona' ? 'persona' : 'compare'
    const endReason =
      sess.mode === 'persona'
        ? 'persona_session_best_overall'
        : 'compare_session_best_overall'
    const endSelectionCategory =
      sess.mode === 'persona' ? 'persona_session_end' : 'compare_session_end'

    const sel = await supabase.from('user_selections').insert([
      {
        session_id: sessionId,
        user_id: user.id,
        selected_ai_provider: provider,
        selected_ai_model: model,
        reason: endReason,
        category: endSelectionCategory,
        created_at: createdAt,
      },
    ])
    if (sel.error) {
      const sel2 = await supabase.from('user_selections').insert([
        {
          session_id: sessionId,
          user_id: user.id,
          selected_ai_provider: provider,
          selected_ai_model: model,
          selected_ai_name: provider,
          category: endSelectionCategory,
        },
      ])
      if (sel2.error) {
        const sel3 = await supabase.from('user_selections').insert([
          {
            session_id: sessionId,
            selected_ai_name: provider,
            reason: endReason,
            category: sessionResultCategory,
          },
        ])
        if (sel3.error) {
          const sel4 = await supabase.from('user_selections').insert([
            {
              session_id: sessionId,
              selected_ai_name: provider,
            },
          ])
          if (sel4.error) console.warn('[compare/end] user_selections:', sel4.error.message)
        }
      }
    }

    const res = await supabase.from('session_results').insert([
      {
        session_id: sessionId,
        winner_ai_name: provider,
        category: sessionResultCategory,
      },
    ])
    if (res.error) {
      const res2 = await supabase.from('session_results').insert([
        {
          session_id: sessionId,
          winner_ai_name: provider,
        },
      ])
      if (res2.error) console.warn('[compare/end] session_results:', res2.error.message)
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
