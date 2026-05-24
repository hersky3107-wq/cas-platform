import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import type { ArenaShareRoundRow } from '@/lib/arena/session-types'
import { supabaseAdmin } from '@/lib/supabase/server'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

function newShareId(): string {
  return randomBytes(12).toString('hex')
}

function parseRoundsBody(raw: unknown): ArenaShareRoundRow[] | null {
  if (!Array.isArray(raw) || raw.length < 1) return null

  const out: ArenaShareRoundRow[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    const ai_name = typeof row.ai_name === 'string' ? row.ai_name.trim() : ''
    if (!ai_name) return null
    const rn = row.round_number
    let round_number: number
    if (typeof rn === 'number' && Number.isFinite(rn)) round_number = rn
    else if (typeof rn === 'string') {
      const parsed = Number.parseInt(rn, 10)
      if (!Number.isFinite(parsed)) return null
      round_number = parsed
    } else {
      return null
    }

    let content: string | null = null
    if (typeof row.content === 'string') content = row.content
    else if (row.content === null) content = null
    else return null

    out.push({ ai_name, content, round_number })
  }
  return out
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

    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    if (!topic) {
      return NextResponse.json({ error: 'topic is required' }, { status: 400 })
    }

    const turnRaw = body.turn_number
    const turn_number =
      typeof turnRaw === 'number' && Number.isFinite(turnRaw)
        ? Math.trunc(turnRaw)
        : typeof turnRaw === 'string'
          ? Number.parseInt(turnRaw, 10)
          : NaN
    if (!(turn_number === 1 || turn_number === 2 || turn_number === 3)) {
      return NextResponse.json(
        { error: 'turn_number must be 1, 2, or 3' },
        { status: 400 }
      )
    }

    const rounds = parseRoundsBody(body.rounds)
    if (!rounds) {
      return NextResponse.json({ error: 'rounds must be a non-empty array' }, { status: 400 })
    }

    const share_id = newShareId()
    const now = new Date().toISOString()

    const { data, error } = await supabaseAdmin
      .from('arena_sessions')
      .insert({
        user_id: user.id,
        topic,
        turn_number,
        rounds,
        is_public: false,
        share_id,
        created_at: now,
        updated_at: now,
      })
      .select('id, share_id')
      .single()

    if (error || !data) {
      console.error('[arena/save-session] insert failed:', error?.message)
      return NextResponse.json(
        { error: error?.message ?? 'Could not save session' },
        { status: 500 }
      )
    }

    return NextResponse.json({ id: data.id, share_id: data.share_id })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[arena/save-session] POST', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
