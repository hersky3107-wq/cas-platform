import { NextResponse } from 'next/server'
import { requireCrisisUser } from '@/lib/crisis/public/auth'
import { loadPublicMap } from '@/lib/crisis/public/store'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const auth = await requireCrisisUser(req)
  if ('response' in auth) return auth.response
  try {
    const { day, regions } = await loadPublicMap(supabaseAdmin)
    return NextResponse.json({ day, regions })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load map'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
