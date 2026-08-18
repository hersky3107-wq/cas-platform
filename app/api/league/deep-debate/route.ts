import { NextResponse } from 'next/server'
import { authorizeRoundForViewer, resolveLeagueViewer } from '@/lib/league/public-access'
import { parseDeepRequest } from '@/lib/league/deep-request'
import { roundHasCards } from '@/lib/league/deep-context'
import { handleDeepAnalysis } from '@/lib/league/deep-http'

export const maxDuration = 300

/**
 * POST /api/league/deep-debate
 *
 * Body allow-list: { roundId, locale?, sessionId? }. Extra text → 400.
 * Context is loaded server-side. Jurisdiction is re-checked every call.
 *
 * Idempotent on (round_id, 'debate', user_id):
 *   completed → replay, no charge
 *   in-progress → resume, no charge
 *   new → charge once, persist every stage
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'invalid_json' }, { status: 400 })
  }

  const parsed = parseDeepRequest(body)
  if (!parsed.ok) return parsed.response

  const auth = await resolveLeagueViewer(req, body)
  if (!auth.ok) return auth.response

  const access = await authorizeRoundForViewer(auth.viewer, parsed.request.roundId)
  if (!access.ok) return access.response

  if (!(await roundHasCards(access.roundId))) {
    return NextResponse.json(
      { error: 'Deep analysis requires a round that already has cards', code: 'no_cards' },
      { status: 409 }
    )
  }

  return handleDeepAnalysis({
    product: 'debate',
    viewer: auth.viewer,
    roundId: access.roundId,
    locale: parsed.request.locale,
    sessionId: parsed.request.sessionId,
  })
}
