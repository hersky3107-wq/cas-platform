import { NextResponse } from 'next/server'
import { resolveLeagueViewer, viewerCatalog } from '@/lib/league/public-access'

/**
 * GET /api/league/instruments
 *
 * The 12-category public catalog this caller may browse, jurisdiction-filtered.
 * Free, read-only — a projection of `lib/league/catalog.ts`. Labels are NOT
 * included: the client resolves them from the locale pack so a language
 * toggle does not need a refetch.
 *
 * WHY IT EXISTS: `catalog.ts` is client-safe, but WHICH categories a caller
 * may see is a server decision. Shipping the full catalog to the client
 * would also mean shipping chips the jurisdiction forbids. A caller whose
 * jurisdiction allows nothing gets `[]` — the hub renders its empty state.
 *
 * This is NOT instrument search. Non-financial categories return
 * `kind: "coming_soon"` with an empty instrument list.
 */
export async function GET(req: Request) {
  const auth = await resolveLeagueViewer(req)
  if (!auth.ok) return auth.response

  const categories = viewerCatalog(auth.viewer).map((c) => ({
    id: c.id,
    ledgerCategory: c.ledgerCategory,
    tone: c.tone,
    kind: c.kind,
    instruments: c.instruments.map((i) => ({
      instrument: i.instrument,
      horizon: i.horizon,
    })),
  }))

  return NextResponse.json({ categories })
}
