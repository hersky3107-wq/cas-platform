import { supabaseAdmin } from '@/lib/supabase/server'
import type { FishingDecisionResult } from '@/lib/jeju/fishing-decision'

export const runtime = 'nodejs'
export const maxDuration = 30

// ─────────────────────────────────────────────────────────────────────────────
// 도민 농수산 AI 조업 판단 — POLL. GET ?jobId=<uuid> → { status, result? }.
// The client polls this every few seconds; a dropped connection during phone
// backgrounding no longer loses the result. Mirrors tourist-course GET.
// ─────────────────────────────────────────────────────────────────────────────

const TABLE = 'jeju_fishing_jobs'

export async function GET(req: Request): Promise<Response> {
  const jobId = new URL(req.url).searchParams.get('jobId')?.trim()
  if (!jobId) {
    return Response.json({ ok: false, error: 'jobId is required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('status, result, error')
    .eq('id', jobId)
    .maybeSingle()

  if (error || !data) {
    return Response.json({ ok: false, error: '작업을 찾을 수 없습니다.' }, { status: 404 })
  }

  const status = (data.status ?? 'pending') as 'pending' | 'done' | 'error'
  return Response.json({
    ok: true,
    status,
    ...(status === 'done' ? { result: data.result as FishingDecisionResult } : {}),
    ...(status === 'error'
      ? { error: (data.error as string) ?? '조업 판단을 만들지 못했어요.' }
      : {}),
  })
}
