import { NextResponse } from 'next/server'
import { isPromptAllowed } from '@/lib/league/jurisdiction/resolve'
import { jurisdictionNotices } from '@/lib/league/gateway/admission'
import { categoryHasMixedResolutionClocks, visibleChipEntriesForViewer } from '@/lib/league/catalog'
import { resolveLeagueViewer, viewerCatalog } from '@/lib/league/public-access'
import { supabaseAdmin } from '@/lib/supabase/server'

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

  // Load recent ranked sports rounds so existing fixtures show as discoverable chips
  let sportsInstruments: { instrument: string }[] = []
  try {
    const { data } = await supabaseAdmin
      .from('prediction_rounds')
      .select('instrument')
      .eq('category', 'sports')
      .eq('item_type', 'ranked')
      .order('created_at', { ascending: false })
      .limit(10)

    if (data && data.length > 0) {
      const seen = new Set<string>()
      for (const row of data as { instrument: string }[]) {
        if (row.instrument && !seen.has(row.instrument)) {
          seen.add(row.instrument)
          sportsInstruments.push({ instrument: row.instrument })
        }
      }
    }
  } catch (err) {
    console.warn('[league/instruments] failed loading sports fixtures:', err)
  }

  const categories = viewerCatalog(viewer).map((c) => {
    if (c.id === 'sports' && sportsInstruments.length > 0) {
      return {
        id: c.id,
        ledgerCategory: c.ledgerCategory,
        tone: c.tone,
        kind: 'instruments' as const,
        promptAllowed: isPromptAllowed(c.id, viewer.jurisdiction),
        instruments: sportsInstruments,
        mixedResolutionClocks: false,
      }
    }
    return {
      id: c.id,
      ledgerCategory: c.ledgerCategory,
      tone: c.tone,
      kind: c.kind,
      promptAllowed: isPromptAllowed(c.id, viewer.jurisdiction),
      instruments: visibleChipEntriesForViewer(c, viewer).map((i) => ({
        instrument: i.instrument,
      })),
      mixedResolutionClocks: categoryHasMixedResolutionClocks(c),
    }
  })

  return NextResponse.json({
    categories,
    jurisdiction: notices,
  })
}
