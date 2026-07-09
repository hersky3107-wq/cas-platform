import { matchSubsidies, type MatchInput } from '@/lib/jeju/welfare'

export const runtime = 'nodejs'
export const maxDuration = 45

// ─────────────────────────────────────────────────────────────────────────────
// 도민(resident) 복지·행정 — 지원금 찾기 (user-condition subsidy match).
// POST /api/domin/welfare/match { age?, job?, situation?, household? }
// → { matches[], contextMeta, disclaimer, errors }
// NOT cached (user-specific). Merged 보조금24 + Perplexity, CODE deadline cut,
// AI matches conditions to REAL items only. Never throws.
// ─────────────────────────────────────────────────────────────────────────────

function parseInput(body: Record<string, unknown>): MatchInput {
  const ageRaw = body.age
  const age =
    typeof ageRaw === 'number'
      ? ageRaw
      : typeof ageRaw === 'string' && ageRaw.trim() && Number.isFinite(Number(ageRaw))
        ? Number(ageRaw)
        : null
  return {
    age: age != null && age > 0 && age < 130 ? age : null,
    job: typeof body.job === 'string' && body.job.trim() ? body.job.trim() : null,
    situation:
      typeof body.situation === 'string' && body.situation.trim() ? body.situation.trim() : null,
    household:
      typeof body.household === 'string' && body.household.trim() ? body.household.trim() : null,
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  try {
    const result = await matchSubsidies(parseInput(body))
    return Response.json(result, { status: 200 })
  } catch (e: unknown) {
    return Response.json(
      {
        ok: false,
        matches: [],
        contextMeta: null,
        disclaimer: '정확한 자격·금액·기한은 반드시 소관기관에 확인하세요.',
        errors: [e instanceof Error ? e.message : String(e)],
      },
      { status: 200 },
    )
  }
}
