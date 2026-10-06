import { NextResponse } from 'next/server'
import { isPromptAllowed } from '@/lib/league/jurisdiction/resolve'
import { jurisdictionNotices } from '@/lib/league/gateway/admission'
import { categoryHasMixedResolutionClocks, visibleChipEntriesForViewer } from '@/lib/league/catalog'
import { admissionStockLane } from '@/lib/league/stock-lane'
import { resolveLeagueViewer, viewerCatalog } from '@/lib/league/public-access'
import { supabaseAdmin } from '@/lib/supabase/server'
import { normalizeLeagueLocale, type LeagueLocale } from '@/lib/league/i18n/locales'
import {
  FREEFORM_RECENT_LIMIT,
  publicCategoryForLedger,
  selectRecentPublicFreeformRounds,
  type FreeformRecentItem,
  type FreeformRecentRow,
} from '@/lib/league/freeform-recent'

const FREEFORM_LEDGER_CATEGORIES = [
  'sports',
  'politics_election',
  'entertainment_awards',
  'real_estate',
  'tech',
  'ai_models',
] as const

async function loadRecentPublicFreeformRounds(
  now: Date,
  locale: LeagueLocale = 'en',
): Promise<Record<string, FreeformRecentItem[]>> {
  const empty: Record<string, FreeformRecentItem[]> = {
    sports: [],
    politics_election: [],
    entertainment: [],
    real_estate: [],
    tech: [],
  }
  try {
    let rows: FreeformRecentRow[] = []
    const withProps = await supabaseAdmin
      .from('prediction_rounds')
      .select(
        'id, instrument, proposition_text, resolves_at, category, created_at, grading_status, actual_outcome, cache_key, horizon, propositions',
      )
      .in('category', [...FREEFORM_LEDGER_CATEGORIES])
      .eq('item_type', 'ranked')
      .eq('is_test', false)
      .gt('resolves_at', now.toISOString())
      .order('created_at', { ascending: false })
      .limit(48)

    if (!withProps.error && withProps.data) {
      rows = withProps.data as FreeformRecentRow[]
    } else {
      const { data } = await supabaseAdmin
        .from('prediction_rounds')
        .select(
          'id, instrument, proposition_text, resolves_at, category, created_at, grading_status, actual_outcome, cache_key, horizon',
        )
        .in('category', [...FREEFORM_LEDGER_CATEGORIES])
        .eq('item_type', 'ranked')
        .eq('is_test', false)
        .gt('resolves_at', now.toISOString())
        .order('created_at', { ascending: false })
        .limit(48)
      rows = (data ?? []) as FreeformRecentRow[]
    }

    const ids = rows.map((row) => row.id)
    const jobRoundIds = new Set<string>()
    if (ids.length > 0) {
      const { data: jobs } = await supabaseAdmin.from('league_generation_jobs').select('round_id').in('round_id', ids)
      for (const job of (jobs ?? []) as { round_id: string }[]) {
        if (job.round_id) jobRoundIds.add(job.round_id)
      }
    }

    const grouped: Record<string, FreeformRecentRow[]> = {
      sports: [],
      politics_election: [],
      entertainment: [],
      real_estate: [],
      tech: [],
    }
    for (const row of rows) {
      const publicId = publicCategoryForLedger(row.category)
      if (!publicId) continue
      grouped[publicId].push(row)
    }
    for (const key of Object.keys(empty)) {
      empty[key] = selectRecentPublicFreeformRounds(grouped[key] ?? [], jobRoundIds, now, FREEFORM_RECENT_LIMIT, locale)
    }
    return empty
  } catch (err) {
    console.warn('[league/instruments] failed loading recent freeform rounds:', err)
    return empty
  }
}

/**
 * GET /api/league/instruments
 *
 * The 12-category public catalog this caller may browse, jurisdiction-filtered.
 * Instrument lists are CHIP-VISIBLE members only — rotated-out catalog
 * members stay gradeable but are omitted here. `promptAllowed` is the
 * (jurisdiction × category) freeform-box flag from the matrix only —
 * admin does not override it. The gateway is the single source of truth.
 *
 * Free-prompt tabs stay `coming_soon` (no auto-selected chip). Open public
 * gateway rounds are attached as `recentRounds` (proposition + deadline).
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
  const url = new URL(req.url)
  const locale = normalizeLeagueLocale(url.searchParams.get('locale')) ?? 'en'
  const recent = await loadRecentPublicFreeformRounds(new Date(), locale)

  const categories = viewerCatalog(viewer).map((c) => {
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
      recentRounds: recent[c.id] ?? [],
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
