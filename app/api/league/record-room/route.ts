import { NextResponse } from 'next/server'
import { RECORD_ROOM_DEFAULT_PAGE_SIZE, fetchRecordRoomPage } from '@/lib/league/record-room'
import { resolveLeagueViewer } from '@/lib/league/public-access'

/**
 * GET /api/league/record-room?page=1&pageSize=20
 *
 * Read-only, paginated list of RESOLVED rounds (most recently resolved
 * first), each with its proposition, actual outcome, resolution timestamp,
 * and every model's directional call + correct/incorrect grade. The public
 * proof-of-fairness log — see `lib/league/record-room-aggregate.ts`. Creates
 * no new data, never mutates anything.
 *
 * FREE for any logged-in user — a cache read, like the card and leaderboard.
 *
 * AUTH: any logged-in user (was admin-only). A non-admin sees only RANKED
 * rounds (the league's own history — on-demand operator runs stay internal)
 * in categories their jurisdiction allows.
 */
export async function GET(req: Request) {
  const auth = await resolveLeagueViewer(req)
  if (!auth.ok) return auth.response
  const { viewer } = auth

  const { searchParams } = new URL(req.url)
  const page = parsePositiveInt(searchParams.get('page')) ?? 1
  const pageSize = parsePositiveInt(searchParams.get('pageSize')) ?? RECORD_ROOM_DEFAULT_PAGE_SIZE

  try {
    const data = await fetchRecordRoomPage(
      page,
      pageSize,
      viewer.isAdmin ? undefined : { categories: viewer.visibleCategories, rankedOnly: true }
    )
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load record room' },
      { status: 500 }
    )
  }
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 ? n : null
}
