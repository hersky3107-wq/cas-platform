import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { encryptText } from '@/lib/db/crypto'

export async function POST(request: Request) {
  const { user_id, provider, api_key } = await request.json()

  if (!user_id || !provider || !api_key) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  await supabaseAdmin
    .from('user_api_keys')
    .delete()
    .eq('user_id', user_id)
    .eq('provider', provider)

  const encrypted = encryptText(api_key)

  const { error } = await supabaseAdmin
    .from('user_api_keys')
    .insert([{ user_id, provider, encrypted_key: encrypted }])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
