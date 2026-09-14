import { NextResponse } from 'next/server'
import { creditsForLeagueRecordRoom } from '@/lib/credits'
import { LEAGUE_VIEW_RATE_RULE } from '@/lib/league/access-policy'
import {
  RECORD_ROOM_DEFAULT_PAGE_SIZE,
  fetchRecordRoomPage,
  listRecentResolvedRoundIds,
} from '@/lib/league/record-room'
import { enforceRateLimit, resolveLeagueViewer } from '@/lib/league/public-access'
import { purchaseLeagueView } from '@/lib/league/view-charge'
import { latestRecordRoomWindow } from '@/lib/league/view-purchases'
import {
  clampRecordRoomQuery,
  lockedViewPayload,
  RECORD_ROOM_PURCHASED_PAGE_SIZE,
  type ArchiveQuery,
} from '@/lib/league/view-purchase-policy'
import type { RecordRoomWindow } from '@/lib/league/view-purchase-policy'

/**
 * GET /api/league/record-room
 *
 * Never charges. Non-admin needs a live record-room purchase; the listing
 * is clipped to that frozen 30-round window. Admin is unbounded.
 *
 * POST /api/league/record-room
 *
 * Purchase (10 credits) or replay. `{ refresh: true }` charges again and
 * freezes a new 30-round window at now.
 */

export async function GET(req: Request) {
  const auth = await resolveLeagueViewer(req)
  if (!auth.ok) return auth.response
  const { viewer } = auth

  const { searchParams } = new URL(req.url)
  const query: ArchiveQuery = {
    page: parsePositiveInt(searchParams.get('page')) ?? 1,
    pageSize: parsePositiveInt(searchParams.get('pageSize')) ?? RECORD_ROOM_PURCHASED_PAGE_SIZE,
    modelId: searchParams.get('modelId')?.trim() || undefined,
    from: searchParams.get('from')?.trim() || undefined,
    to: searchParams.get('to')?.trim() || undefined,
    format: 'json',
  }

  try {
    if (viewer.isAdmin) {
      const data = await fetchRecordRoomPage(query.page, query.pageSize || RECORD_ROOM_DEFAULT_PAGE_SIZE, {
        modelId: query.modelId,
        from: query.from,
        to: query.to,
        deep: true,
      })
      return NextResponse.json(data)
    }

    const window = await latestRecordRoomWindow(viewer.userId)
    if (!window) {
      return NextResponse.json(lockedViewPayload('record_room', creditsForLeagueRecordRoom()))
    }
    const data = await loadPurchasedWindow(query, window, viewer.visibleCategories)
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load record room' },
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

  const limited = enforceRateLimit(viewer, 'league_record_room', LEAGUE_VIEW_RATE_RULE)
  if (limited) return limited

  const refresh = body.refresh === true
  const query: ArchiveQuery = {
    page: 1,
    pageSize: RECORD_ROOM_PURCHASED_PAGE_SIZE,
    format: 'json',
  }

  try {
    if (viewer.isAdmin) {
      const data = await fetchRecordRoomPage(1, RECORD_ROOM_DEFAULT_PAGE_SIZE, { deep: true })
      return NextResponse.json(data)
    }

    const bought = await purchaseLeagueView({
      userId: viewer.userId,
      product: 'record_room',
      refresh,
    })
    if (!bought.ok) return bought.response

    const window = bought.purchase
      ? {
          asOf: bought.purchase.as_of ?? new Date().toISOString(),
          roundLimit: bought.purchase.round_limit ?? 30,
        }
      : await latestRecordRoomWindow(viewer.userId)
    if (!window) {
      return NextResponse.json(lockedViewPayload('record_room', creditsForLeagueRecordRoom()))
    }
    const data = await loadPurchasedWindow(query, window, viewer.visibleCategories)
    return NextResponse.json({ ...data, charged: bought.charged })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to open record room' },
      { status: 500 }
    )
  }
}

async function loadPurchasedWindow(
  query: ArchiveQuery,
  window: RecordRoomWindow,
  categories: readonly string[]
) {
  const windowRoundIds = await listRecentResolvedRoundIds({
    asOf: window.asOf,
    limit: window.roundLimit,
    categories,
  })
  const clamped = clampRecordRoomQuery(query, {
    roundCount: windowRoundIds.length,
    to: window.asOf,
  })
  return fetchRecordRoomPage(clamped.page, clamped.pageSize, {
    categories,
    modelId: clamped.modelId,
    from: clamped.from,
    to: clamped.to,
    deep: true,
    windowRoundIds,
    window,
  })
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 ? n : null
}
