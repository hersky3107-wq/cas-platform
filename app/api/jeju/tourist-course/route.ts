import { after } from 'next/server'
import { generateCourses, generateCustomCourses } from '@/lib/jeju/tourist-course'
import { normalizeAiLocale, type AiLocale } from '@/lib/jeju/ai-locale'
import { supabaseAdmin } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 120

// TODO: credit/auth gating before public launch

// ─────────────────────────────────────────────────────────────────────────────
// JEJU tourist AI 여행 코스 추천 route — KICK-OFF + POLLING (mirrors the
// jeju_deep_sessions Supabase-table store pattern used by the DEEP pipeline).
//
// The compute (pool + sonar + sonnet compose) is a single ~105s job. Holding one
// long HTTP request open dies when a phone backgrounds >30s and the OS drops the
// connection (the fetch AbortErrors and the result is lost). Instead:
//
//   POST                 → insert a 'pending' job row, return { jobId } in <200ms,
//                          then run the SAME sonar+compose logic in a Next.js
//                          after() background task (runs up to maxDuration, backed
//                          by Vercel waitUntil) and write result+status to the row.
//   GET  ?jobId=<uuid>   → return the job's current status (+ result when done).
//
// The client polls GET every few seconds, so backgrounding no longer loses the
// result — the next poll picks up the persisted job. Korean/other locales are
// unchanged: the exact same generateCourses/generateCustomCourses run, just off
// the request path.
//
// The engine uses its own noDbSupabase() (sessionId/userId null); this route's
// only DB use is the job row via the service-role client. NO import from
// app/api/synod/* or any AIMANI credit path.
// ─────────────────────────────────────────────────────────────────────────────

const TABLE = 'jeju_course_jobs'

type CourseMode = 'custom' | 'standard'
type CourseDuration = '반나절' | '하루'

/** Normalized, validated job input (persisted as `input`, re-read by the worker). */
type JobInput = {
  mode: CourseMode
  query: string
  duration?: CourseDuration
  area?: string
  locale: AiLocale
  companion?: string
  ageGroup?: string
  groupSize?: number
}

type CourseResult =
  | { ok: true; courses: unknown[] }
  | { ok: false; error: string }

function parseInput(body: Record<string, unknown>): JobInput {
  const mode: CourseMode = body.mode === 'custom' ? 'custom' : 'standard'
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  const duration: CourseDuration | undefined =
    body.duration === '반나절' || body.duration === '하루' ? body.duration : undefined
  const area =
    typeof body.area === 'string' && body.area.trim() ? body.area.trim() : undefined
  const locale = normalizeAiLocale(body.locale)

  const input: JobInput = { mode, query, duration, area, locale }

  if (mode === 'custom') {
    if (typeof body.companion === 'string' && body.companion.trim()) {
      input.companion = body.companion.trim()
    }
    if (typeof body.ageGroup === 'string' && body.ageGroup.trim()) {
      input.ageGroup = body.ageGroup.trim()
    }
    const groupSizeRaw =
      typeof body.groupSize === 'number' ? body.groupSize : Number(body.groupSize)
    if (Number.isFinite(groupSizeRaw) && groupSizeRaw > 0) {
      input.groupSize = Math.floor(groupSizeRaw)
    }
  }

  return input
}

/** Runs the actual sonar+compose work for a job (identical to the old inline path). */
async function computeCourses(input: JobInput): Promise<CourseResult> {
  if (input.mode === 'custom') {
    return generateCustomCourses({
      query: input.query,
      duration: input.duration,
      area: input.area,
      companion: input.companion,
      ageGroup: input.ageGroup,
      groupSize: input.groupSize,
      locale: input.locale,
    })
  }
  return generateCourses({
    query: input.query,
    duration: input.duration,
    area: input.area,
    locale: input.locale,
  })
}

// ── POST: kick-off ────────────────────────────────────────────────────────────
export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body tolerated; defaults applied in parseInput
  }

  const input = parseInput(body)

  const ins = await supabaseAdmin
    .from(TABLE)
    .insert([{ status: 'pending', input }])
    .select('id')
    .single()

  if (ins.error || !ins.data?.id) {
    return Response.json(
      { ok: false, error: ins.error?.message ?? '작업을 생성하지 못했습니다.' },
      { status: 500 }
    )
  }

  const jobId = String(ins.data.id)

  // Run the heavy compute AFTER the response is flushed. On Vercel this is backed
  // by waitUntil and runs up to `maxDuration` (120s) — enough for sonar+compose.
  after(async () => {
    try {
      const result = await computeCourses(input)
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
        .update({
          status: 'error',
          error,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
    }
  })

  return Response.json({ ok: true, jobId })
}

// ── GET: poll ───────────────────────────────────────────────────────────────
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
    ...(status === 'done' ? { result: data.result as CourseResult } : {}),
    ...(status === 'error' ? { error: (data.error as string) ?? '코스를 만들지 못했어요.' } : {}),
  })
}
