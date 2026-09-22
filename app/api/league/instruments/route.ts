import { NextResponse } from 'next/server'
import { isPromptAllowed } from '@/lib/league/jurisdiction/resolve'
import { jurisdictionNotices } from '@/lib/league/gateway/admission'
import { categoryHasMixedResolutionClocks, visibleChipEntriesForViewer } from '@/lib/league/catalog'
import { resolveLeagueViewer, viewerCatalog } from '@/lib/league/public-access'

/**
 * GET /api/league/instruments
 *
 * The 12-category public catalog this caller may browse, jurisdiction-filtered.
 * Instrument lists are CHIP-VISIBLE members only — rotated-out catalog
 * members stay gradeable but are omitted here. `promptAllowed` is the
 * (jurisdiction × category) freeform-box flag from the matrix only —
 * admin does not override it. The gateway is the single source of truth.
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
    promptAllowed: isPromptAllowed(c.id, viewer.jurisdiction),
    instruments: visibleChipEntriesForViewer(c, viewer).map((i) => ({
      instrument: i.instrument,
    })),
    mixedResolutionClocks: categoryHasMixedResolutionClocks(c),
  }))

  return NextResponse.json({
    categories,
    jurisdiction: notices,
  })
}
