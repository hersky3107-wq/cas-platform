import { NextResponse } from 'next/server'
import { isPromptAllowed } from '@/lib/league/jurisdiction/resolve'
import { jurisdictionNotices } from '@/lib/league/gateway/admission'
import { visibleChipEntries } from '@/lib/league/catalog'
import { resolveLeagueViewer, viewerCatalog } from '@/lib/league/public-access'

/**
 * GET /api/league/instruments
 *
 * The 12-category public catalog this caller may browse, jurisdiction-filtered.
 * Instrument lists are CHIP-VISIBLE members only — rotated-out catalog
 * members stay gradeable but are omitted here. `promptAllowed` is the
 * (jurisdiction × category) freeform-box flag; the gateway still enforces
 * it server-side.
 */
export async function GET(req: Request) {
  const auth = await resolveLeagueViewer(req)
  if (!auth.ok) return auth.response

  const viewer = auth.viewer
  const notices = jurisdictionNotices({
    userId: viewer.userId,
    isAdmin: viewer.isAdmin,
    jurisdiction: viewer.jurisdiction,
  })

  const categories = viewerCatalog(viewer).map((c) => ({
    id: c.id,
    ledgerCategory: c.ledgerCategory,
    tone: c.tone,
    kind: c.kind,
    promptAllowed: viewer.isAdmin || isPromptAllowed(c.id, viewer.jurisdiction),
    instruments: visibleChipEntries(c).map((i) => ({
      instrument: i.instrument,
    })),
  }))

  return NextResponse.json({
    categories,
    jurisdiction: notices,
  })
}
