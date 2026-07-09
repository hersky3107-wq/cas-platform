import { getGuide, GUIDE_TOPICS } from '@/lib/jeju/welfare'

export const runtime = 'nodejs'
export const maxDuration = 45

// ─────────────────────────────────────────────────────────────────────────────
// 도민(resident) 복지·행정 — 민원 안내 (admin how-to, button-driven).
// GET /api/domin/welfare/guide?topic=전입신고
// → { topic, intro, steps[], documents[], where, contextMeta, disclaimer }
// One Perplexity call per topic, cached per KST day per topic.
// GET /api/domin/welfare/guide (no topic) → { topics: [...] } for the picker.
// Query: ?force=1 bypasses cache (non-prod, or WELFARE_CACHE_FORCE_KEY match).
// ─────────────────────────────────────────────────────────────────────────────

function allowForce(url: URL): boolean {
  if (url.searchParams.get('force') !== '1') return false
  if (process.env.NODE_ENV !== 'production') return true
  const expected = process.env.WELFARE_CACHE_FORCE_KEY
  if (!expected) return false
  return url.searchParams.get('key') === expected
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const topic = url.searchParams.get('topic')?.trim() ?? ''

  // No topic → return the picker list
  if (!topic) {
    return Response.json({ ok: true, topics: GUIDE_TOPICS }, { status: 200 })
  }

  const force = allowForce(url)
  try {
    const result = await getGuide(topic, { force })
    return Response.json(result, { status: result.ok ? 200 : 200 })
  } catch (e: unknown) {
    return Response.json(
      {
        ok: false,
        topic,
        intro: '',
        steps: [],
        documents: [],
        where: null,
        contextMeta: null,
        disclaimer: '정확한 내용은 소관기관에 확인하세요.',
        errors: [e instanceof Error ? e.message : String(e)],
        fromCache: false,
      },
      { status: 200 },
    )
  }
}
