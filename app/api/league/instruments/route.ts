import { NextResponse } from 'next/server'
import { isPromptAllowed } from '@/lib/league/jurisdiction/resolve'
import { jurisdictionNotices } from '@/lib/league/gateway/admission'
import { categoryHasMixedResolutionClocks, visibleChipEntriesForViewer } from '@/lib/league/catalog'
import { admissionStockLane } from '@/lib/league/stock-lane'
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
  const stockLane = admissionStockLane(viewer.jurisdiction)

  // Load recent ranked sports / tech / AI-ranking rounds so opened questions
  // stay discoverable chips on those hub tabs.
  let sportsInstruments: { instrument: string }[] = []
  let techHubInstruments: { instrument: string }[] = []
  try {
    const { data: sportsData } = await supabaseAdmin
      .from('prediction_rounds')
      .select('instrument')
      .eq('category', 'sports')
      .eq('item_type', 'ranked')
      .order('created_at', { ascending: false })
      .limit(10)

    if (sportsData && sportsData.length > 0) {
      const seen = new Set<string>()
      for (const row of sportsData as { instrument: string }[]) {
        if (row.instrument && !seen.has(row.instrument)) {
          seen.add(row.instrument)
          sportsInstruments.push({ instrument: row.instrument })
        }
      }
    }
  } catch (err) {
    console.warn('[league/instruments] failed loading sports fixtures:', err)
  }
  try {
    const { data: techData } = await supabaseAdmin
      .from('prediction_rounds')
      .select('instrument')
      .in('category', ['tech', 'ai_models'])
      .eq('item_type', 'ranked')
      .order('created_at', { ascending: false })
      .limit(12)

    if (techData && techData.length > 0) {
      const seen = new Set<string>()
      for (const row of techData as { instrument: string }[]) {
        if (row.instrument && !seen.has(row.instrument)) {
          seen.add(row.instrument)
          techHubInstruments.push({ instrument: row.instrument })
        }
      }
    }
  } catch (err) {
    console.warn('[league/instruments] failed loading tech / AIRANK rounds:', err)
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
    if (c.id === 'tech' && techHubInstruments.length > 0) {
      return {
        id: c.id,
        ledgerCategory: c.ledgerCategory,
        tone: c.tone,
        kind: 'instruments' as const,
        promptAllowed: isPromptAllowed(c.id, viewer.jurisdiction),
        instruments: techHubInstruments,
        mixedResolutionClocks: false,
      }
    }
    return {
      id: c.id,
      ledgerCategory: c.ledgerCategory,
      tone: c.tone,
      kind: c.kind,
      promptAllowed: isPromptAllowed(c.id, viewer.jurisdiction),
      instruments:
        c.id === 'stocks'
          ? []
          : visibleChipEntriesForViewer(c, viewer).map((i) => ({
              instrument: i.instrument,
            })),
      mixedResolutionClocks: categoryHasMixedResolutionClocks(c),
    }
  })

  return NextResponse.json({
    categories,
    jurisdiction: notices,
    stockLane,
    viewerIsAdmin: viewer.isAdmin,
  })
}
