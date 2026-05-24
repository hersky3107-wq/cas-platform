import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { parseSuitResponses, type SuitSessionResponse } from '@/lib/suit/session-types'
import { supabaseAdmin } from '@/lib/supabase/server'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

function newShareId(): string {
  return randomBytes(12).toString('hex')
}

function parseResponsesBody(raw: unknown): SuitSessionResponse[] | null {
  if (!Array.isArray(raw) || raw.length < 1) return null
  const parsed = parseSuitResponses(raw)
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
      .from('suit_sessions')
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
      console.error('[suit/save-session] insert failed:', error?.message)
      return NextResponse.json(
        { error: error?.message ?? 'Could not save session' },
        { status: 500 }
      )
    }

    return NextResponse.json({ id: data.id, share_id: data.share_id })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[suit/save-session] POST', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
