import { NextResponse } from 'next/server'
import { creditsForLeagueLeaderboard } from '@/lib/credits'
import { LEAGUE_VIEW_RATE_RULE } from '@/lib/league/access-policy'
import { fetchLeaderboardData } from '@/lib/league/leaderboard'
import { enforceRateLimit, resolveLeagueViewer } from '@/lib/league/public-access'
import { purchaseLeagueView } from '@/lib/league/view-charge'
import { hasLeaderboardAccess } from '@/lib/league/view-purchases'
import { lockedViewPayload } from '@/lib/league/view-purchase-policy'

/**
 * GET /api/league/leaderboard
 *
 * Read-only rankings. Never charges. A non-admin without a live
 * `league_view_purchases` row gets the locked payload (no ranks).
 * Admin skips the purchase check (operator preview).
 *
 * POST /api/league/leaderboard
 *
 * One-time purchase (2 credits). Permanent live access — later grades
 * update the board. Re-POST after purchase does not charge again.
 */

async function loadBoard(categories: readonly string[] | undefined) {
  return fetchLeaderboardData(categories ? { categories } : undefined)
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
    const data = await loadBoard(viewer.isAdmin ? undefined : viewer.visibleCategories)
    return NextResponse.json(data)
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
    const data = await loadBoard(viewer.isAdmin ? undefined : viewer.visibleCategories)
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to open leaderboard' },
      { status: 500 }
    )
  }
}
