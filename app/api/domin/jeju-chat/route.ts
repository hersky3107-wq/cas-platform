import { chatJeju } from '@/lib/jeju/chat'

export const runtime = 'nodejs'
export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// Jeju-specialist chatbot — 도민(resident) mode.
// POST /api/domin/jeju-chat { messages: [{role, content}, ...] }
// → { reply, usedSearch, searchRaw, contextMeta, routedVia, errors }
//
// Single Sonnet turn (+ optional Perplexity ≤2). Direct response (not polling) —
// search turns may take ~20–40s; maxDuration=60 covers that. Never throws.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  // Accept either messages[] or a single { question } / { message } string.
  let messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  if (Array.isArray(body.messages)) {
    messages = body.messages
      .filter((m): m is { role: string; content: string } => !!m && typeof m === 'object')
      .map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: typeof m.content === 'string' ? m.content : '',
      }))
      .filter((m) => m.content.trim())
  } else {
    const q =
      (typeof body.question === 'string' && body.question) ||
      (typeof body.message === 'string' && body.message) ||
      ''
    if (q.trim()) messages = [{ role: 'user', content: q.trim() }]
  }

  if (messages.length === 0) {
    return Response.json({ ok: false, error: 'messages 또는 question이 필요해요.' }, { status: 400 })
  }

  try {
    const result = await chatJeju({ messages })
    if (!result.ok) {
      return Response.json(result, { status: 400 })
    }
    return Response.json(result, { status: 200 })
  } catch (e: unknown) {
    return Response.json(
      {
        ok: true,
        reply: '지금은 답변을 만들지 못했어요. 잠시 후 다시 물어봐 주세요.',
        usedSearch: false,
        searchRaw: null,
        contextMeta: null,
        routedVia: 'internal',
        errors: [e instanceof Error ? e.message : String(e)],
      },
      { status: 200 },
    )
  }
}
