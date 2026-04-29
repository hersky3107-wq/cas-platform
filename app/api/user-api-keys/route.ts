import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { encryptText } from '@/lib/db/crypto'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
export async function POST(request: Request) {
  const { user_id, provider, api_key } = await request.json()

  const encrypted = encryptText(api_key)

  const { error } = await supabase.from('user_api_keys').insert([
    {
      user_id,
      provider,
      encrypted_key: encrypted
    }
  ])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}