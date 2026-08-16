import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'
import { CardNotFoundError, fetchCardData, type CardLookup } from '@/lib/league/card'

/**
 * GET /api/league/card?round_id=<uuid>
 * GET /api/league/card?instrument=AAPL[&date=YYYY-MM-DD]
 *
 * Read-only. Returns the assembled `CardData` (round meta + per-model list +
 * server-computed aggregates) for one round. Never generates or mutates
 * anything — that stays with the orchestrator/cron
 * (`lib/league/orchestrator.ts`, `app/api/cron/league/open`), which this
 * route does not import.
 *
 * AUTH (seam for later): admin-gated for now, same as the rest of the league
 * surface, because `prediction_rounds` / `model_predictions` are service-role
 * only (RLS default-deny) and there is no public/jurisdiction gating layer
 * yet. Swapping `requireAdmin` for a public+jurisdiction check later is a
 * one-line change here — the data-assembly layer (`fetchCardData`) does not
 * know or care who is allowed to call it.
 */
export async function GET(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden

  const { searchParams } = new URL(req.url)
  const lookup = parseLookup(searchParams)
  if (!lookup) {
    return NextResponse.json(
      { error: 'Provide either ?round_id=<uuid> or ?instrument=<SYMBOL>[&date=YYYY-MM-DD]' },
      { status: 400 }
    )
  }

  try {
    const card = await fetchCardData(lookup)
    return NextResponse.json(card)
  } catch (e: unknown) {
    if (e instanceof CardNotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 })
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load card' },
      { status: 500 }
    )
  }
}

function parseLookup(searchParams: URLSearchParams): CardLookup | null {
  const roundId = searchParams.get('round_id')?.trim()
  if (roundId) return { roundId }

  const instrument = searchParams.get('instrument')?.trim()
  if (instrument) {
    const date = searchParams.get('date')?.trim()
    return date ? { instrument, date } : { instrument }
  }

  return null
}
