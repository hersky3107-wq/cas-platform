import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { supabaseAdmin } from '@/lib/supabase/server'

function nextAnnouncementVersion(current: string | null | undefined): string {
  const c = String(current ?? 'v1').trim()
  const m = /^v(\d+)$/i.exec(c)
  if (m) return `v${Number(m[1]) + 1}`
  return 'v2'
}

export async function GET(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden

  const { data, error } = await supabaseAdmin
    .from('announcements')
    .select('id, text, version, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    text: data?.text ?? '',
    version: data?.version ?? 'v1',
    updated_at: data?.updated_at ?? null,
  })
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  const { data: latest } = await supabaseAdmin
    .from('announcements')
    .select('version')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const version = nextAnnouncementVersion(latest?.version as string | undefined)
  const updated_at = new Date().toISOString()

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('announcements')
    .insert([{ text, version, updated_at }])
    .select('text, version, updated_at')
    .single()

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    text: inserted?.text ?? text,
    version: inserted?.version ?? version,
    updated_at: inserted?.updated_at ?? updated_at,
  })
}
