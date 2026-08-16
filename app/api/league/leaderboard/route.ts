import { NextResponse } from 'next/server'
import { fetchLeaderboardData } from '@/lib/league/leaderboard'
import { resolveLeagueViewer } from '@/lib/league/public-access'

/**
 * GET /api/league/leaderboard
 *
 * Read-only. Aggregates already-resolved `model_predictions` rows into
 * win-rate rankings sliced by model / camp / league tier / category (see
 * `lib/league/leaderboard-aggregate.ts` for the exact scope/exclusion rules
 * and `lib/league/leaderboard.ts` for the one-pass DB read). Creates no new
 * data, never mutates `model_predictions` or `prediction_rounds`.
 *
 * FREE for any logged-in user — this is a cache read over already-computed
 * grades, and it is the hook that sells the paid paths. No credits here.
 *
 * AUTH: any logged-in user (was admin-only). Rankings are built ONLY from
 * categories the caller's jurisdiction allows, so a blocked category cannot
 * leak through an aggregate; a caller with no visible categories gets the
 * regular empty-state payload rather than a partial one.
 */
export async function GET(req: Request) {
  const auth = await resolveLeagueViewer(req)
  if (!auth.ok) return auth.response
  const { viewer } = auth

  try {
    const data = await fetchLeaderboardData(
      viewer.isAdmin ? undefined : { categories: viewer.visibleCategories }
    )
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load leaderboard' },
      { status: 500 }
    )
  }
}
