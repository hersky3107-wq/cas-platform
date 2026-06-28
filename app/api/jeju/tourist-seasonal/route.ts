import { getSeasonalSights } from '@/lib/jeju/tourist-seasonal'

export const runtime = 'nodejs'
export const maxDuration = 60

// TODO: credit/auth gating before public launch

// ─────────────────────────────────────────────────────────────────────────────
// JEJU tourist seasonal route — mirrors app/api/jeju/tourist-festivals/route.ts.
// POST (empty body OK) → getSeasonalSights({ today }) → JSON.
// The engine uses its own noDbSupabase() (sessionId/userId null), so this route
// needs no Supabase. today is computed here so the model gets the real date.
// NO import from app/api/synod/* or any AIMANI credit path.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(): Promise<Response> {
  const today = new Date().toISOString().slice(0, 10)

  try {
    const result = await getSeasonalSights({ today })
    return Response.json(result)
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'Internal error'
    return Response.json({ ok: false, error }, { status: 500 })
  }
}
