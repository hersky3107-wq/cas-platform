import { findLocalGems } from '@/lib/jeju/tourist-local'
import { normalizeAiLocale } from '@/lib/jeju/ai-locale'

export const runtime = 'nodejs'
export const maxDuration = 60

// TODO: credit/auth gating before public launch

// ─────────────────────────────────────────────────────────────────────────────
// JEJU tourist local-gems route — mirrors app/api/jeju/tourist/route.ts.
// Single-shot: POST { query } → findLocalGems({ query, today }) → JSON.
// The engine uses its own noDbSupabase() (sessionId/userId null), so this route
// needs no Supabase. today is computed here so Perplexity gets the real date.
// NO import from app/api/synod/* or any AIMANI credit path.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body tolerated; validated below
  }

  const query =
    typeof body.query === 'string' && body.query.trim() ? body.query.trim() : ''
  if (!query) {
    return Response.json(
      { ok: false, error: '무엇을 찾고 싶은지 입력해 주세요.' },
      { status: 400 }
    )
  }

  // Inject today's real date so Perplexity prioritises recent info.
  const today = new Date().toISOString().slice(0, 10)
  const locale = normalizeAiLocale(body.locale)

  try {
    const result = await findLocalGems({ query, today, locale })
    return Response.json(result)
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'Internal error'
    return Response.json({ ok: false, error }, { status: 500 })
  }
}
