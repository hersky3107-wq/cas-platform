import { NextResponse } from 'next/server'
import { CardNotFoundError, fetchCardData, type CardLookup } from '@/lib/league/card'
import {
  authorizeRoundForViewer,
  resolveLeagueViewer,
  resolvePublicInstrumentRound,
} from '@/lib/league/public-access'
import { isUiHorizon } from '@/lib/league/horizon'

/**
 * GET /api/league/card?round_id=<uuid>
 * GET /api/league/card?instrument=AAPL[&horizon=1d|1w|1m|3m][&date=YYYY-MM-DD]
 *
 * `horizon` selects among the 4 fixed horizon codes (default `1d`, matching
 * every caller written before horizon selection existed). An unrecognized
 * horizon is 400 `unknown_horizon` — never silently defaulted.
 *
 * Read-only. Returns the assembled `CardData` (round meta + per-model list +
 * server-computed aggregates) for one round. Never generates or mutates
 * anything — that stays with the orchestrator/cron
 * (`lib/league/orchestrator.ts`, `app/api/cron/league/open`), which this
 * route does not import.
 *
 * FREE, AND DELIBERATELY SO: a stored/cached card view costs us a couple of
 * indexed selects, and it is the funnel for everything that does cost money.
 * No `deductCreditsBalance` call belongs in this file. Live generation is the
 * only paid league read path (`POST /api/league/generate-stream`).
 *
 * AUTH: any logged-in user (was admin-only). `prediction_rounds` /
 * `model_predictions` are service-role tables (RLS default-deny), so this
 * route IS the access control for them — see `lib/league/public-access.ts`:
 *  - non-admin: RANKED rounds on CURATED instruments only, and only if the
 *    round's category is allowed in their resolved jurisdiction (403);
 *  - admin: any round / instrument / date, for operator preview.
 */
export async function GET(req: Request) {
  const auth = await resolveLeagueViewer(req)
  if (!auth.ok) return auth.response
  const { viewer } = auth

  const { searchParams } = new URL(req.url)
  const roundId = searchParams.get('round_id')?.trim() || ''
  const instrument = searchParams.get('instrument')?.trim() || ''
  const horizonRaw = searchParams.get('horizon')?.trim() || '1d'

  let lookup: CardLookup | null = null

  if (viewer.isAdmin) {
    lookup = parseAdminLookup(searchParams)
  } else if (roundId) {
    const access = await authorizeRoundForViewer(viewer, roundId)
    if (!access.ok) return access.response
    lookup = { roundId: access.roundId }
  } else if (instrument) {
    if (!isUiHorizon(horizonRaw)) {
      return NextResponse.json({ error: 'Unknown horizon', code: 'unknown_horizon' }, { status: 400 })
    }
    const access = await resolvePublicInstrumentRound(viewer, instrument, horizonRaw)
    if (!access.ok) return access.response
    // Public reads resolve to the latest ranked round for the instrument at
    // this horizon; the `date` parameter stays an admin/preview affordance.
    lookup = { roundId: access.roundId }
  }

  if (!lookup) {
    return NextResponse.json(
      { error: 'Provide either ?round_id=<uuid> or ?instrument=<SYMBOL>[&date=YYYY-MM-DD]' },
      { status: 400 }
    )
  }

  try {
    const card = await fetchCardData(
      lookup,
      viewer.isAdmin ? undefined : { categories: viewer.visibleCategories }
    )
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

function parseAdminLookup(searchParams: URLSearchParams): CardLookup | null {
  const roundId = searchParams.get('round_id')?.trim()
  if (roundId) return { roundId }

  const instrument = searchParams.get('instrument')?.trim()
  if (instrument) {
    const date = searchParams.get('date')?.trim()
    const horizon = searchParams.get('horizon')?.trim()
    return { instrument, ...(date ? { date } : {}), ...(horizon ? { horizon } : {}) }
  }

  return null
}
