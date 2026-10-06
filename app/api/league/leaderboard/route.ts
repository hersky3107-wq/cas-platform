import { NextResponse } from 'next/server'
import { creditsForLeagueLeaderboard } from '@/lib/credits'
import { LEAGUE_VIEW_RATE_RULE } from '@/lib/league/access-policy'
import { readLeaderboardBoards, readLiveLeaderboardBoards } from '@/lib/league/boards/cache.server'
import { parseBoardDoor, parseBoardFilters } from '@/lib/league/boards/filters'
import { enforceRateLimit, resolveLeagueViewer, type LeagueViewer } from '@/lib/league/public-access'
import { purchaseLeagueView } from '@/lib/league/view-charge'
import { hasLeaderboardAccess } from '@/lib/league/view-purchases'
import { lockedViewPayload } from '@/lib/league/view-purchase-policy'

/**
 * GET /api/league/leaderboard?door=&cat=&h=&p=
 *
 * Read-only boards from `league_board_cache` (public graded rounds only: no
 * test, no voided). Never charges and never computes, except a
 * jurisdiction-narrowed category set no rebuild plans. A non-admin without a
 * live `league_view_purchases` row gets the locked payload (no ranks). Admin
 * skips the purchase check; `test=1` is an admin-only live preview that
 * includes test rounds and is never cached.
 *
 * POST /api/league/leaderboard
 *
 * One-time purchase (2 credits). Permanent live access — later grades
 * update the board. Re-POST after purchase does not charge again.
 */

async function loadBoards(viewer: LeagueViewer, get: (name: string) => string | null | undefined) {
  const filters = parseBoardFilters(get, parseBoardDoor(get('door'), 'all'))
  if (viewer.isAdmin && get('test') === '1') return readLiveLeaderboardBoards(filters)
  return readLeaderboardBoards(filters, viewer.isAdmin ? null : viewer.visibleCategories)
}

export async function GET(req: Request) {
  const auth = await resolveLeagueViewer(req)
  if (!auth.ok) return auth.response
  const { viewer } = auth

  try {
    if (!viewer.isAdmin) {
      const owned = await hasLeaderboardAccess(viewer.userId)
      if (!owned) {
        return NextResponse.json(lockedViewPayload('leaderboard', creditsForLeagueLeaderboard()))
      }
    }
    const params = new URL(req.url).searchParams
    return NextResponse.json(await loadBoards(viewer, (name) => params.get(name)))
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load leaderboard' },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try {
    const parsed = await req.json()
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch {
    body = {}
  }

  const auth = await resolveLeagueViewer(req, body)
  if (!auth.ok) return auth.response
  const { viewer } = auth

  const limited = enforceRateLimit(viewer, 'league_leaderboard', LEAGUE_VIEW_RATE_RULE)
  if (limited) return limited

  try {
    if (!viewer.isAdmin) {
      const bought = await purchaseLeagueView({ userId: viewer.userId, product: 'leaderboard' })
      if (!bought.ok) return bought.response
    }
    return NextResponse.json(
      await loadBoards(viewer, (name) => (typeof body[name] === 'string' ? (body[name] as string) : null)),
    )
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to open leaderboard' },
      { status: 500 }
    )
  }
}
