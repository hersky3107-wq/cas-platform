import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { supabaseAdmin } from '@/lib/supabase/server'
import { generatePredictions, type RoundInput } from '@/lib/league/orchestrator'
import type { LeagueTier } from '@/lib/league/roster'

/** Fan-out across the roster with a per-call timeout; give it headroom. */
export const maxDuration = 180

const VALID_TIERS: LeagueTier[] = ['premier', 'challenger', 'world', 'scout']

/**
 * Admin/service-role-only trigger for the AI Prediction League generation
 * orchestrator. Asks the roster INDEPENDENTLY about one proposition and writes
 * rows into prediction_rounds / model_predictions. No UI, no streaming, no
 * credit charging in this pass — returns a plain JSON summary.
 *
 * Body (JSON):
 *   { roundId: string }                       // reuse an existing round
 *   OR
 *   { round: { proposition_text, category, instrument, horizon,
 *              resolution_rule, resolves_at, item_type? } }   // create one
 *   Optional: tiers?: ('premier'|'challenger'|'world'|'scout')[]  // roster subset
 *             concurrency?: number   // default 6
 *             timeoutMs?: number     // default 60000
 *
 * POST /api/admin/league/generate
 */
export async function POST(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const roundInput = buildRoundInput(body)
  if (!roundInput) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Provide either { roundId } or { round: { proposition_text, category, instrument, horizon, resolution_rule, resolves_at } }',
      },
      { status: 400 }
    )
  }

  const tiers = parseTiers(body.tiers)
  const concurrency = numOrUndefined(body.concurrency)
  const timeoutMs = numOrUndefined(body.timeoutMs)
  const maxCompletionTokens = numOrUndefined(body.maxCompletionTokens)
  const costCapUsd = numOrUndefined(body.costCapUsd)
  const userId = await getAdminUserId(req)

  try {
    const result = await generatePredictions({
      round: roundInput,
      tiers,
      concurrency,
      timeoutMs,
      maxCompletionTokens,
      costCapUsd,
      userId,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'generation failed' },
      { status: 500 }
    )
  }
}

function buildRoundInput(body: Record<string, unknown>): RoundInput | null {
  if (typeof body.roundId === 'string' && body.roundId.trim()) {
    return { roundId: body.roundId.trim() }
  }
  const r = body.round
  if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>
    const required = ['proposition_text', 'category', 'instrument', 'horizon', 'resolution_rule', 'resolves_at']
    if (required.every((k) => typeof o[k] === 'string' && (o[k] as string).length > 0)) {
      const itemType = o.item_type === 'on_demand' ? 'on_demand' : 'ranked'
      return {
        proposition_text: o.proposition_text as string,
        category: o.category as string,
        instrument: o.instrument as string,
        horizon: o.horizon as string,
        resolution_rule: o.resolution_rule as string,
        resolves_at: o.resolves_at as string,
        item_type: itemType,
        season_id: typeof o.season_id === 'string' ? o.season_id : null,
        cache_key: typeof o.cache_key === 'string' ? o.cache_key : null,
      }
    }
  }
  return null
}

function parseTiers(raw: unknown): LeagueTier[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const tiers = raw.filter((t): t is LeagueTier => VALID_TIERS.includes(t as LeagueTier))
  return tiers.length ? tiers : undefined
}

function numOrUndefined(raw: unknown): number | undefined {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Resolve the admin's user id (for optional core-model BYOK reads). Mirrors the health route. */
async function getAdminUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined
  let jwt = bearer
  if (!jwt) {
    const { createSupabaseRouteAuthClient } = await import('@/lib/supabase/route-auth')
    const authClient = await createSupabaseRouteAuthClient(req)
    const {
      data: { session },
    } = await authClient.auth.getSession()
    jwt = session?.access_token
  }
  if (!jwt) return null
  const { data, error } = await supabaseAdmin.auth.getUser(jwt)
  if (error || !data.user?.id) return null
  return data.user.id
}
