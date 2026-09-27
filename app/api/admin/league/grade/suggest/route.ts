import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { suggestManualOutcome } from '@/lib/league/manual-grade'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const roundId = body && typeof body === 'object' && typeof (body as { roundId?: unknown }).roundId === 'string'
    ? (body as { roundId: string }).roundId
    : ''
  if (!roundId) return NextResponse.json({ error: 'roundId is required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('proposition_text, resolution_rule, category, instrument, resolves_at, grading_status')
    .eq('id', roundId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'round not found' }, { status: 404 })

  const suggestion = await suggestManualOutcome({
    proposition_text: String(data.proposition_text ?? ''),
    resolution_rule: String(data.resolution_rule ?? ''),
    category: String(data.category ?? ''),
    instrument: String(data.instrument ?? ''),
    resolves_at: String(data.resolves_at ?? ''),
  })
  return NextResponse.json({ suggestion })
}
