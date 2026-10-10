import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { publishableIndices } from '@/lib/crisis/admin/publish'
import { buildLedgerInserts } from '@/lib/crisis/engine/publish'
import { insertHypothesis, loadRun, markPublished } from '@/lib/crisis/engine/store'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden

  let body: { runId?: unknown }
  try {
    body = (await req.json()) as { runId?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const runId = typeof body.runId === 'string' ? body.runId.trim() : ''
  if (!runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 })

  try {
    const run = await loadRun(supabaseAdmin, runId)
    if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 })
    const indices = publishableIndices(run.result)
    if (indices.length === 0) return NextResponse.json({ error: 'run has nothing to publish' }, { status: 400 })
    const inserts = buildLedgerInserts(run, indices, new Date().toISOString())
    const ids: number[] = []
    for (const insert of inserts) {
      const saved = await insertHypothesis(supabaseAdmin, insert)
      ids.push(saved.id)
    }
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('crisis_engine_runs')
      .select('published_hypothesis_ids')
      .eq('id', runId)
      .single()
    if (existingError) throw new Error(existingError.message)
    const previous = Array.isArray(existing?.published_hypothesis_ids)
      ? existing.published_hypothesis_ids.map(Number)
      : []
    await markPublished(supabaseAdmin, runId, [...previous, ...ids])
    return NextResponse.json({ ok: true, publishedIds: ids, public: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publish failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
