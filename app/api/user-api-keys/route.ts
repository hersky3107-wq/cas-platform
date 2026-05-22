import { NextResponse } from 'next/server'
import { encryptText } from '@/lib/db/crypto'
import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { user, error: authErr } = await resolveRouteAuth(request, body)
  if (authErr || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
  const api_key = typeof body.api_key === 'string' ? body.api_key : ''

  if (!provider || !api_key) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const userId = user.id

  await supabaseAdmin
    .from('user_api_keys')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider)

  const encrypted = encryptText(api_key)

  const { error } = await supabaseAdmin
    .from('user_api_keys')
    .insert([{ user_id: userId, provider, encrypted_key: encrypted }])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
