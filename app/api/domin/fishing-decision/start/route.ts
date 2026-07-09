import { after } from 'next/server'
import { runFishingDecision, type FishingDecisionResult } from '@/lib/jeju/fishing-decision'
import { supabaseAdmin } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 120

// ─────────────────────────────────────────────────────────────────────────────
// 도민(resident) 농수산 AI 조업 판단 — KICK-OFF (mirrors tourist-course / DEEP).
//
// The compute fans out to /api/domin/marine + /api/domin/fishery-price (each with
// its own upstream + Perplexity calls) plus one Sonnet-tier synthesis, exceeding
// 30s. Holding one long HTTP request open dies when a phone backgrounds. Instead:
//   POST → insert a 'pending' job row, return { jobId } fast, then run the compute
//          in a Next.js after() background task and write result+status to the row.
//   GET  (status route) ?jobId → returns the row's status (+ result when done).
//
// The engine uses its own noDbSupabase() (sessionId/userId null); this route's
// only DB use is the job row via the service-role client. NO synod/DEEP imports.
// ─────────────────────────────────────────────────────────────────────────────

const TABLE = 'jeju_fishing_jobs'

type JobInput = { species: string; spot: string }

function parseInput(body: Record<string, unknown>): JobInput {
  const species = typeof body.species === 'string' ? body.species.trim() : ''
  const spot = typeof body.spot === 'string' && body.spot.trim() ? body.spot.trim() : '이호테우'
  return { species, spot }
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body tolerated; defaults applied in parseInput
  }

  const input = parseInput(body)
  if (!input.species) {
    return Response.json({ ok: false, error: 'species는 필수입니다.' }, { status: 400 })
  }

  const ins = await supabaseAdmin
    .from(TABLE)
    .insert([{ status: 'pending', input }])
    .select('id')
    .single()

  if (ins.error || !ins.data?.id) {
    return Response.json(
      { ok: false, error: ins.error?.message ?? '작업을 생성하지 못했습니다.' },
      { status: 500 },
    )
  }

  const jobId = String(ins.data.id)

  // Run the heavy compute AFTER the response is flushed (Vercel waitUntil-backed).
  after(async () => {
    try {
      const result: FishingDecisionResult = await runFishingDecision(input.species, input.spot)
      await supabaseAdmin
        .from(TABLE)
        .update({
          status: result.ok ? 'done' : 'error',
          result,
          error: result.ok ? null : result.error,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Internal error'
      await supabaseAdmin
        .from(TABLE)
        .update({ status: 'error', error, updated_at: new Date().toISOString() })
        .eq('id', jobId)
    }
  })

  return Response.json({ ok: true, jobId })
}
