import { generateCourses, generateCustomCourses } from '@/lib/jeju/tourist-course'

export const runtime = 'nodejs'
export const maxDuration = 90

// TODO: credit/auth gating before public launch

// ─────────────────────────────────────────────────────────────────────────────
// JEJU tourist AI 여행 코스 추천 route — mirrors the other tourist routes.
// POST body supports two modes:
//   mode === 'custom'   → generateCustomCourses(...) (Mode 1: 2 situation-tailored)
//   default/'standard'  → generateCourses({ query, duration, area }) (Mode 2: 4 themed)
// This does pool + sonar + sonnet, so maxDuration is generous (90s).
// The engine uses its own noDbSupabase() (sessionId/userId null), so this route
// needs no Supabase. NO import from app/api/synod/* or any AIMANI credit path.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body tolerated; defaults applied below
  }

  const query = typeof body.query === 'string' ? body.query.trim() : ''
  const duration =
    body.duration === '반나절' || body.duration === '하루' ? body.duration : undefined
  const area = typeof body.area === 'string' && body.area.trim() ? body.area.trim() : undefined

  try {
    if (body.mode === 'custom') {
      const companion =
        typeof body.companion === 'string' && body.companion.trim()
          ? body.companion.trim()
          : undefined
      const ageGroup =
        typeof body.ageGroup === 'string' && body.ageGroup.trim()
          ? body.ageGroup.trim()
          : undefined
      const groupSizeRaw =
        typeof body.groupSize === 'number' ? body.groupSize : Number(body.groupSize)
      const groupSize =
        Number.isFinite(groupSizeRaw) && groupSizeRaw > 0 ? Math.floor(groupSizeRaw) : undefined

      const result = await generateCustomCourses({
        query,
        duration,
        area,
        companion,
        ageGroup,
        groupSize,
      })
      return Response.json(result)
    }

    const result = await generateCourses({ query, duration, area })
    return Response.json(result)
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'Internal error'
    return Response.json({ ok: false, error }, { status: 500 })
  }
}
