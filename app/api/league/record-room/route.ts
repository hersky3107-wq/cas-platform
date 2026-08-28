import { NextResponse } from 'next/server'
import { RECORD_ROOM_FREE_PAGE_SIZE, isFreeArchiveQuery, type ArchiveQuery } from '@/lib/league/access-policy'
import { RECORD_ROOM_DEFAULT_PAGE_SIZE, fetchRecordRoomPage } from '@/lib/league/record-room'
import { creditsForLeagueArchive } from '@/lib/credits'
import { resolveLeagueViewer } from '@/lib/league/public-access'

/**
 * GET /api/league/record-room?page=1&pageSize=5
 *
 * FREE recent-summary for any logged-in user: the latest resolved rounds
 * (proof-of-fairness / viral / funnel layer). Deep operations — page > 1,
 * larger page size, model filter, date range, CSV — are refused here with
 * 403 `deep_archive_required` and must go through
 * `POST /api/league/record-room/deep` (credits).
 *
 * Admin may paginate and filter on this GET without paying (operator preview).
 */
export async function GET(req: Request) {
  const auth = await resolveLeagueViewer(req)
  if (!auth.ok) return auth.response
  const { viewer } = auth

  const { searchParams } = new URL(req.url)
  const query: ArchiveQuery = {
    page: parsePositiveInt(searchParams.get('page')) ?? 1,
    pageSize: parsePositiveInt(searchParams.get('pageSize')) ?? RECORD_ROOM_FREE_PAGE_SIZE,
    modelId: searchParams.get('modelId')?.trim() || undefined,
    from: searchParams.get('from')?.trim() || undefined,
    to: searchParams.get('to')?.trim() || undefined,
    format: searchParams.get('format') === 'csv' ? 'csv' : 'json',
  }

  if (!viewer.isAdmin && !isFreeArchiveQuery(query)) {
    return NextResponse.json(
      {
        error: 'Deep archive requires credits',
        code: 'deep_archive_required',
        required: creditsForLeagueArchive(),
      },
      { status: 403 }
    )
  }

  const pageSize = viewer.isAdmin ? query.pageSize : Math.min(query.pageSize, RECORD_ROOM_FREE_PAGE_SIZE)

  try {
    const data = await fetchRecordRoomPage(
      query.page,
      viewer.isAdmin ? pageSize || RECORD_ROOM_DEFAULT_PAGE_SIZE : pageSize,
      viewer.isAdmin
        ? { modelId: query.modelId, from: query.from, to: query.to, deep: true }
        : { categories: viewer.visibleCategories, deep: false }
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
