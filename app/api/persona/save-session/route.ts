import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { parsePersonaResponses, type PersonaSessionResponse } from '@/lib/persona/session-types'
import { supabaseAdmin } from '@/lib/supabase/server'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

function newShareId(): string {
  return randomBytes(12).toString('hex')
}

function parseResponsesBody(raw: unknown): PersonaSessionResponse[] | null {
  if (!Array.isArray(raw) || raw.length < 1) return null
  const parsed = parsePersonaResponses(raw)
  return parsed.length > 0 ? parsed : null
}

export async function POST(req: Request) {
  try {
    const missingSb = missingSupabaseEnv()
    if (missingSb) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missingSb}` },
        { status: 503 }
      )
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { user, error: authErr } = await resolveRouteAuth(req, body)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const question = typeof body.question === 'string' ? body.question.trim() : ''
    if (!question) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 })
    }

    const responses = parseResponsesBody(body.responses)
    if (!responses) {
      return NextResponse.json({ error: 'responses must be a non-empty array' }, { status: 400 })
    }

    const share_id = newShareId()
    const now = new Date().toISOString()

    const { data, error } = await supabaseAdmin
      .from('persona_sessions')
      .insert({
        user_id: user.id,
        question,
        responses,
        is_public: false,
        share_id,
        created_at: now,
        updated_at: now,
      })
      .select('id, share_id')
      .single()

    if (error || !data) {
      console.error('[persona/save-session] insert failed:', error?.message)
      return NextResponse.json({ error: error?.message ?? 'Could not save session' }, { status: 500 })
    }

    return NextResponse.json({ id: data.id, share_id: data.share_id })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[persona/save-session] POST', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const missingSb = missingSupabaseEnv()
    if (missingSb) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missingSb}` },
        { status: 503 }
      )
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { user, error: authErr } = await resolveRouteAuth(req, body)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const session_id = typeof body.session_id === 'string' ? body.session_id.trim() : ''
    const voted_ai = typeof body.voted_ai === 'string' ? body.voted_ai.trim() : ''
    if (!session_id || !voted_ai) {
      return NextResponse.json(
        { error: 'session_id and voted_ai are required' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('persona_sessions')
      .update({ voted_ai, updated_at: new Date().toISOString() })
      .eq('id', session_id)
      .eq('user_id', user.id)
      .select('id')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[persona/save-session] PATCH', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
