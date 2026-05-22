import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

/** Public read of the latest site announcement banner. */
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('announcements')
    .select('text, version')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data?.text || !data?.version) {
    return NextResponse.json({ text: null, version: null })
  }

  return NextResponse.json({
    text: String(data.text),
    version: String(data.version),
  })
}
